#!/usr/bin/env python3
"""Fill POC secrets in the existing root environment file; never print them."""
import os
import re
import secrets
import sys
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else '.env')
if not path.is_file():
    raise SystemExit('Initialize the existing root .env first.')
text = path.read_text()
values = {
    'REPAIR_LINK_SECRET': lambda: secrets.token_urlsafe(48),
    'OPENWA_MASTER_KEY': lambda: secrets.token_urlsafe(48),
    'OPENWA_KEY_PEPPER': lambda: secrets.token_urlsafe(48),
    'WHATSAPP_ENABLED': lambda: 'false',
}
for key, generate in values.items():
    pattern = rf'^{key}=(.*)$'
    match = re.search(pattern, text, flags=re.MULTILINE)
    if match and match.group(1).strip().strip('\"\''):
        continue
    line = key + '=' + generate()
    if match:
        text = re.sub(pattern, lambda _: line, text, flags=re.MULTILINE)
    else:
        text = text.rstrip() + '\n' + line + '\n'
temporary = path.with_name(path.name + '.repairs-tmp')
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    with os.fdopen(fd, 'w') as f:
        f.write(text)
    os.replace(temporary, path)
finally:
    temporary.unlink(missing_ok=True)
print('Repair POC secrets are ready; existing values were preserved.')
