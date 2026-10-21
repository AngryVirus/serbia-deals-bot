"""Recovery checks use synthetic users and local files; never Telegram/Cloud."""
import gzip
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deals_backup', ROOT/'serverless/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
ENV = dict(os.environ, TGCLOUD_TOKEN='app1234567890:synthetic_backup_key_for_unit_tests_only')


def rows():
    return {
        'sd_meta': [{'key': 'users_tracking', 'value': '12345'}],
        'sd_users': [{'id': 101, 'enabled': 1, 'blocked': 0, 'payload': json.dumps({'name': 'Synthetic', 'pending': 'ban', 'adminDraft': {'target': 202}})}],
        'sd_basket': [{'uid': 101, 'id': 'basket-1', 'query': 'пончик', 'product': None, 'name': None, 'quantity': 3}],
        'sd_basket_filters': [{'uid': 101, 'id': 'basket-1', 'payload': '{"brand":"Synthetic"}'}],
        'sd_watches': [{'uid': 101, 'product': 'local:synthetic', 'name': 'Krofna', 'baseline': 10000}],
        'sd_admin_records': [{'kind': 'ban', 'key': '202', 'payload': '{"active":true,"notice":"pending","reason":"Synthetic"}', 'at': 12345}],
    }


def encrypted(source=None):
    source = rows() if source is None else source
    db = backup.build_database(source, 12345)
    try:
        return backup.crypt(gzip.compress(db.serialize()), 'encrypt', ENV)
    finally:
        db.close()


class BackupTests(unittest.TestCase):
    def test_full_roundtrip_and_offline_restored_bot(self):
        report = backup.restore_drill(encrypted(), backup.digest(rows()), ENV)
        self.assertTrue(report['integrity'])
        self.assertTrue(report['offline_bot'])
        self.assertEqual(report['sends'], 0)
        self.assertEqual(report['counts'], {t: len(v) for t, v in rows().items()})
        self.assertNotIn('Synthetic', backup.canonical(report))

    def test_missing_table_extra_columns_and_unsupported_records_fail(self):
        incomplete = rows()
        del incomplete['sd_watches']
        with self.assertRaises(ValueError):
            backup.build_database(incomplete, 12345)
        bad = rows()
        bad['sd_users'][0]['unexpected'] = 'private'
        with self.assertRaises(ValueError):
            backup.build_database(bad, 12345)
        bad = rows()
        bad['sd_admin_records'][0]['kind'] = 'ad_campaign'
        with self.assertRaises(ValueError):
            backup.build_database(bad, 12345)
        bad = rows()
        bad['sd_meta'].append({'key': 'active', 'value': 'true'})
        with self.assertRaises(ValueError):
            backup.build_database(bad, 12345)

    def test_wrong_digest_authenticated_corruption_and_wrong_key_fail(self):
        packed = encrypted()
        with self.assertRaises(ValueError):
            backup.restore_drill(packed, '0'*64, ENV)
        changed = bytearray(packed)
        changed[-1] ^= 1
        with self.assertRaises(RuntimeError):
            backup.restore_drill(bytes(changed), env=ENV)
        with self.assertRaises(RuntimeError):
            backup.restore_drill(packed, env=dict(ENV, TGCLOUD_TOKEN='app1:wrong_synthetic_token'))

    def test_manifest_mismatch_and_extra_table_rejected_after_decryption(self):
        for change in ("UPDATE sd_backup_manifest SET value='\"wrong\"' WHERE key='full_record_digest'",
                       'CREATE TABLE unexpected(private TEXT)'):
            db = backup.build_database(rows(), 12345)
            db.execute(change)
            db.commit()
            packed = backup.crypt(gzip.compress(db.serialize()), 'encrypt', ENV)
            db.close()
            with self.assertRaises(ValueError):
                backup.restore_drill(packed, env=ENV)

    def test_artifact_report_binding_and_private_file_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'users.sdcbk'
            packed = encrypted()
            report = backup.restore_drill(packed, env=ENV)
            backup.private_write(path, packed)
            backup.private_write(path.with_suffix('.report.json'), backup.canonical(report).encode())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(backup.verify_pair(path, ENV), report)
            with self.assertRaises(FileExistsError):
                backup.private_write(path, b'replacement')
            report['counts']['sd_users'] = 999
            path.with_suffix('.report.json').write_text(backup.canonical(report))
            with self.assertRaises(ValueError):
                backup.verify_pair(path, ENV)

    def test_local_restore_is_paused_and_does_not_change_archive(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, ENV):
            path, output = Path(directory)/'users.sdcbk', Path(directory)/'restored.sqlite'
            packed = encrypted()
            backup.private_write(path, packed)
            backup.private_write(path.with_suffix('.report.json'), backup.canonical(backup.restore_drill(packed, env=ENV)).encode())
            result = backup.restore_local(path, output)
            self.assertTrue(result['paused'])
            self.assertEqual(path.read_bytes(), packed)
            db = sqlite3.connect(output)
            self.assertEqual(json.loads(db.execute("SELECT value FROM sd_meta WHERE key='active'").fetchone()[0]), False)
            self.assertEqual(db.execute('SELECT baseline FROM sd_watches').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT quantity FROM sd_basket').fetchone()[0], 3)
            self.assertNotIn('adminDraft', json.loads(db.execute('SELECT payload FROM sd_users').fetchone()[0]))
            db.close()
            with self.assertRaises(FileExistsError):
                backup.restore_local(path, output)

    def test_create_uses_snapshot_and_releases_even_on_failure(self):
        source = rows()
        calls = []

        def invoke(operation, **fields):
            calls.append(operation)
            if operation == 'backup_create':
                return {'id': fields['id'], 'version': 1, 'pagination': 'keyset-v1', 'created_at': 12345,
                        'counts': {t: len(source[t]) for t in backup.TABLES}}
            if operation == 'backup_page':
                return {'rows': source[fields['table']] if fields['after'] is None else [], 'next': '0001'}
            return {'released': True}

        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'invoke', side_effect=invoke), patch.dict(os.environ, ENV):
            report = backup.create_backup(Path(directory)/'users.sdcbk')
            self.assertTrue(report['offline_bot'])
            self.assertEqual(calls[-1], 'backup_release')
        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'invoke', side_effect=[RuntimeError('private'), {'released': True}]) as call:
            with self.assertRaises(RuntimeError):
                backup.create_backup(Path(directory)/'users.sdcbk')
            self.assertEqual(call.call_args_list[-1].args, ('backup_release',))

    def test_bad_page_counts_do_not_write_an_artifact(self):
        def invoke(operation, **fields):
            if operation == 'backup_create':
                return {'id': fields['id'], 'version': 1, 'pagination': 'keyset-v1', 'created_at': 12345,
                        'counts': {t: 1 for t in backup.TABLES}}
            return {'rows': [], 'next': None}
        with tempfile.TemporaryDirectory() as directory, patch.object(backup, 'invoke', side_effect=invoke):
            path = Path(directory)/'users.sdcbk'
            with self.assertRaises(ValueError):
                backup.create_backup(path)
            self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
