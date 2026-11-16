#!/usr/bin/env python3
"""Fill messaging secrets in the existing root environment file; never print them."""
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
    'SERVICE_JOB_ALERTS_ENABLED': lambda: 'false',
    'SERVICE_JOB_LINK_SECRET': lambda: secrets.token_urlsafe(48),
    'META_WHATSAPP_ACCESS_TOKEN': lambda: '',
    'META_WHATSAPP_PHONE_NUMBER_ID': lambda: '',
    'META_WHATSAPP_BUSINESS_ACCOUNT_ID': lambda: '',
    'META_WHATSAPP_APP_SECRET': lambda: '',
    'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN': lambda: secrets.token_urlsafe(48),
    'META_WHATSAPP_JOB_TEMPLATE': lambda: 'vhh_service_job_alert',
    'META_WHATSAPP_TEMPLATE_LANGUAGE': lambda: 'en_US',
    'META_WHATSAPP_API_VERSION': lambda: 'v25.0',
    'FLEET_CONTACT_PHONE': lambda: '',
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
temporary = path.with_name(path.name + '.messaging-tmp')
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    with os.fdopen(fd, 'w') as f:
        f.write(text)
    os.replace(temporary, path)
finally:
    temporary.unlink(missing_ok=True)
print('Messaging secrets are ready; existing values were preserved.')
