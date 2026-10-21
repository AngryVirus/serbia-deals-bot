"""Encrypted private-state backup; recovery checks never connect to Telegram.

Only ciphertext and an aggregate report may leave this process. Catalogue data
is public and can be recollected; delivery queues and UI drafts are not restored.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from collector.cloud import invoke

SCHEMA = {
    'sd_meta': 'key TEXT PRIMARY KEY,value TEXT NOT NULL',
    'sd_users': 'id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,blocked INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL DEFAULT \'{}\'',
    'sd_basket': 'uid INTEGER NOT NULL,id TEXT NOT NULL,query TEXT NOT NULL,product TEXT,name TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(uid,id)',
    'sd_basket_filters': 'uid INTEGER NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(uid,id)',
    'sd_watches': 'uid INTEGER NOT NULL,product TEXT NOT NULL,name TEXT NOT NULL,baseline INTEGER NOT NULL,PRIMARY KEY(uid,product)',
    'sd_admin_records': 'kind TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(kind,key)',
}
TABLES = tuple(SCHEMA)
MAX_DATABASE = 128 * 1024 * 1024
MAX_ENCRYPTED = 64 * 1024 * 1024 + 68
MAX_ROWS = 1000000
SAFE_FAILURE = 'Backup operation failed; private details withheld'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(rows):
    return hashlib.sha256(canonical({t: sorted(canonical(r) for r in rows[t]) for t in TABLES}).encode()).hexdigest()


def check_rows(rows):
    if set(rows) != set(TABLES) or any(not isinstance(v, list) for v in rows.values()):
        raise ValueError('Incomplete backup tables')
    if sum(map(len, rows.values())) > MAX_ROWS:
        raise ValueError('Backup size limit')
    for row in rows['sd_admin_records']:
        if row.get('kind') not in ('role', 'ban'):
            raise ValueError('Unexpected administration record')
    for row in rows['sd_meta']:
        if row.get('key') not in ('users_tracking', 'ad_daily_limit'):
            raise ValueError('Unexpected metadata')
    for row in rows['sd_users']:
        if type(row.get('id')) is not int or not 0 < row['id'] <= 2**53-1:
            raise ValueError('Invalid user identity')
        if row.get('enabled') not in (0, 1) or row.get('blocked') not in (0, 1):
            raise ValueError('Invalid user preference')
    for table in TABLES:
        for row in rows[table]:
            if 'payload' in row and not isinstance(json.loads(row['payload']), dict):
                raise ValueError('Invalid record payload')


def read_database(db):
    db.row_factory = sqlite3.Row
    return {t: [dict(r) for r in db.execute(f'SELECT * FROM {t}')] for t in TABLES}


def build_database(rows, created_at):
    check_rows(rows)
    if type(created_at) is not int or created_at <= 0:
        raise ValueError('Invalid snapshot timestamp')
    db = sqlite3.connect(':memory:')
    try:
        for table, definition in SCHEMA.items():
            db.execute(f'CREATE TABLE {table} ({definition})')
            columns = [r[1] for r in db.execute(f'PRAGMA table_info({table})')]
            for row in rows[table]:
                if set(row) != set(columns):
                    raise ValueError('Unexpected backup columns')
                db.execute(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", [row[c] for c in columns])
        metadata = {'version': 1, 'bot': 'SerbiaDealsBot', 'created_at': created_at,
                    'full_record_digest': digest(rows), 'counts': {t: len(rows[t]) for t in TABLES}}
        db.execute('CREATE TABLE sd_backup_manifest(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        db.executemany('INSERT INTO sd_backup_manifest VALUES(?,?)', [(k, canonical(v)) for k, v in metadata.items()])
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Backup integrity failure')
        return db
    except BaseException:
        db.close()
        raise


def crypt(data, mode, env=None):
    result = subprocess.run(['node', str(ROOT/'backup_crypto.mjs'), mode], input=data,
                            env=os.environ if env is None else env, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Backup encryption/authentication failed')
    return result.stdout


def decrypt_database(encrypted, env=None):
    if len(encrypted) > MAX_ENCRYPTED:
        raise ValueError('Backup size limit')
    packed = crypt(encrypted, 'decrypt', env)
    with gzip.GzipFile(fileobj=io.BytesIO(packed)) as stream:
        clear = stream.read(MAX_DATABASE+1)
    if len(clear) > MAX_DATABASE:
        raise ValueError('Restored database size limit')
    db = sqlite3.connect(':memory:')
    try:
        db.deserialize(clear)
        db.execute('PRAGMA trusted_schema=OFF')
        objects = db.execute("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").fetchall()
        if any(kind != 'table' for kind, _, _ in objects) or {name for _, name, _ in objects} != {*TABLES, 'sd_backup_manifest'}:
            raise ValueError('Unexpected restored schema')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Restored database integrity failure')
        # Rebuild from primitive rows: do not execute table definitions from an
        # archive, even after its authentication succeeded.
        rows = read_database(db)
        check_rows(rows)
        metadata = {k: json.loads(v) for k, v in db.execute('SELECT key,value FROM sd_backup_manifest')}
        if (set(metadata) != {'version', 'bot', 'created_at', 'full_record_digest', 'counts'}
                or metadata['version'] != 1 or metadata['bot'] != 'SerbiaDealsBot'
                or metadata['full_record_digest'] != digest(rows)
                or metadata['counts'] != {t: len(rows[t]) for t in TABLES}):
            raise ValueError('Full-record recovery comparison failed')
        rebuilt = build_database(rows, metadata['created_at'])
        rebuilt.close()
        return clear, metadata
    finally:
        db.close()


def offline_check(path):
    # The checker has no SDK/network code. Credentials are explicitly removed
    # from its environment and no user records are returned in diagnostics.
    safe_env = {k: v for k, v in os.environ.items() if not re.search(r'TOKEN|SECRET|PASSWORD|CREDENTIAL', k, re.I)}
    result = subprocess.run(['node', str(ROOT/'restore_check.mjs'), str(path)],
                            capture_output=True, env=safe_env, timeout=60)
    if result.returncode:
        raise RuntimeError('Offline restored-bot validation failed')
    try:
        check = json.loads(result.stdout)
    except ValueError:
        raise RuntimeError('Offline restored-bot validation failed') from None
    if check.get('offline_bot') is not True or check.get('paused') is not True or check.get('sends') != 0:
        raise RuntimeError('Unsafe restored-bot state')


def restore_drill(encrypted, expected_digest=None, env=None):
    clear, metadata = decrypt_database(encrypted, env)
    if expected_digest is not None and metadata['full_record_digest'] != expected_digest:
        raise ValueError('Artifact digest mismatch')
    with tempfile.TemporaryDirectory(prefix='sd-recovery-') as directory:
        path = Path(directory)/'restored.sqlite'
        private_write(path, clear)
        offline_check(path)
    return {**metadata, 'integrity': True, 'offline_bot': True, 'sends': 0,
            'artifact_sha256': hashlib.sha256(encrypted).hexdigest()}


def private_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents accidentally replacing a recovery database.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def verify_pair(path, env=None):
    report = json.loads(path.with_suffix('.report.json').read_text())
    actual = restore_drill(path.read_bytes(), report.get('full_record_digest'), env)
    if report != actual:
        raise ValueError('Artifact/report mismatch')
    return actual


def create_backup(path):
    snapshot = str(uuid.uuid4())
    try:
        for attempt in range(20):
            manifest = invoke('backup_create', id=snapshot)
            if not manifest.get('busy'):
                break
            time.sleep(2)
        else:
            raise RuntimeError('No quiet snapshot boundary; retry next run')
        if (manifest.get('id') != snapshot or manifest.get('version') != 1
                or manifest.get('pagination') != 'keyset-v1'
                or set(manifest.get('counts', {})) != set(TABLES)
                or any(type(n) is not int or not 0 <= n <= MAX_ROWS for n in manifest['counts'].values())):
            raise ValueError('Invalid snapshot manifest')
        if sum(manifest['counts'].values()) > MAX_ROWS:
            raise ValueError('Backup row limit')
        rows = {t: [] for t in TABLES}
        total_bytes = 0
        for table in TABLES:
            after = None
            while True:
                page = invoke('backup_page', id=snapshot, table=table, after=after)
                if not isinstance(page.get('rows'), list) or len(page['rows']) > 200:
                    raise ValueError('Invalid snapshot page')
                if not page['rows']:
                    break
                if not isinstance(page.get('next'), str) or after is not None and page['next'] <= after:
                    raise ValueError('Snapshot cursor did not advance')
                rows[table].extend(page['rows'])
                total_bytes += len(canonical(page['rows']).encode())
                if total_bytes > MAX_DATABASE:
                    raise ValueError('Backup size limit')
                if len(rows[table]) > manifest['counts'][table]:
                    raise ValueError('Snapshot count exceeded')
                after = page['next']
            if len(rows[table]) != manifest['counts'][table]:
                raise ValueError('Incomplete snapshot')
        db = build_database(rows, manifest['created_at'])
        try:
            clear = db.serialize()
        finally:
            db.close()
        if len(clear) > MAX_DATABASE:
            raise ValueError('Backup size limit')
        encrypted = crypt(gzip.compress(clear, mtime=0), 'encrypt')
        report = restore_drill(encrypted, digest(rows))
        private_write(path, encrypted)
        # Verify bytes actually written, not only a buffer from before the save.
        if restore_drill(path.read_bytes(), report['full_record_digest']) != report:
            raise ValueError('Written artifact mismatch')
        private_write(path.with_suffix('.report.json'), canonical(report).encode())
        return report
    finally:
        # A failed release never erases the original failure and leftover
        # snapshot staging is also removed by the next create after 24 hours.
        try:
            invoke('backup_release', id=snapshot)
        except Exception:
            pass


def restore_local(path, output):
    report = verify_pair(path)
    clear, _ = decrypt_database(path.read_bytes())
    private_write(output, clear)
    try:
        offline_check(output)
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return {'restored_local': True, 'paused': True, 'sends': 0, 'counts': report['counts']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['create', 'verify-pair', 'restore-local'])
    parser.add_argument('path', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        if args.operation == 'create':
            result = create_backup(args.path)
        elif args.operation == 'verify-pair':
            result = verify_pair(args.path)
        else:
            if args.output is None:
                raise ValueError('A new output path is required')
            result = restore_local(args.path, args.output)
        print(canonical(result))
    except Exception:
        raise SystemExit(SAFE_FAILURE) from None


if __name__ == '__main__':
    main()
