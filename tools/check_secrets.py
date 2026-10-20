"""Scan tracked files without printing detected values or sending them for verification."""
import json
import subprocess
import sys
import hashlib
from pathlib import Path
import re

files = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
result = subprocess.run([sys.executable, '-m', 'detect_secrets', 'scan', '--no-verify',
                         *filter(None, files)], text=True, capture_output=True)
if result.returncode:
    raise SystemExit('Secret scanner failed; private output withheld')
findings = json.loads(result.stdout)['results']
# Reviewed public identifiers, not credentials. Keep this exception restricted
# to the exact JSON field, file, hash and explicit official-dataset URL list.
approved = {hashlib.sha1(url.rstrip('/').rsplit('/', 1)[-1].encode()).hexdigest()
            for url in Path('tools/public-datasets.txt').read_text().splitlines()
            if re.fullmatch(r'https://data\.gov\.rs/sr/datasets/[a-f0-9]{24}/', url)}
for filename in ('collector/sources.json', 'docs/SOURCE_AUDIT.json'):
    lines = Path(filename).read_text().splitlines()
    findings[filename] = [entry for entry in findings.get(filename, []) if not (
        entry['type'] == 'Hex High Entropy String'
        and entry.get('hashed_secret') in approved
        and re.fullmatch(r'\s*"(?:id|dataset)": "[a-f0-9]{24}",?', lines[entry['line_number']-1]))]
findings = {name: entries for name, entries in findings.items() if entries}
if findings:
    for filename, entries in findings.items():
        print(filename, 'lines:', ', '.join(str(item['line_number']) for item in entries))
    raise SystemExit('Potential secrets found; values withheld')
print('Secret scan passed')
