#!/usr/bin/env python3
"""Initialize server-only Fleet configuration. Never prints credentials."""
import argparse, json, os, secrets
from pathlib import Path
from urllib.parse import quote
parser=argparse.ArgumentParser()
parser.add_argument('--owner-email',required=True)
parser.add_argument('--owner-first-name',default='Fleet')
parser.add_argument('--owner-last-name',default='Owner')
parser.add_argument('--root',default='/opt/fleet')
a=parser.parse_args()
root=Path(a.root)
root.mkdir(mode=0o700,parents=True,exist_ok=True)
env=root/'.env'
if env.exists():
    print('Existing Fleet environment retained.')
    raise SystemExit(0)
if '@' not in a.owner_email or any(c in a.owner_email for c in '\r\n'):
    raise SystemExit('A valid initial owner email is required.')
values={k:secrets.token_hex(32) for k in ['POSTGRES_PASSWORD','APP_DB_PASSWORD','KRATOS_DB_PASSWORD','APP_CSRF_SECRET','KRATOS_COOKIE_SECRET','KRATOS_HOOK_SECRET','KRATOS_UI_COOKIE_SECRET','KRATOS_UI_CSRF_SECRET']}
values['KRATOS_CIPHER_SECRET']=secrets.token_urlsafe(24)
values['DATABASE_URL']=f"postgres://fleet_app:{quote(values['APP_DB_PASSWORD'])}@postgres:5432/fleet?sslmode=disable"
values['KRATOS_DSN']=f"postgres://fleet_kratos:{quote(values['KRATOS_DB_PASSWORD'])}@postgres:5432/fleet?sslmode=disable&search_path=kratos,extensions&max_conns=10&max_idle_conns=2"
values.update(INITIAL_OWNER_EMAIL=a.owner_email,INITIAL_OWNER_FIRST_NAME=a.owner_first_name,INITIAL_OWNER_LAST_NAME=a.owner_last_name,INITIAL_OWNER_PASSWORD=secrets.token_urlsafe(32),SMTP_CONNECTION_URI='smtp://mailpit:1025/?disable_starttls=true',SMTP_FROM_ADDRESS='no-reply@nativesounds.co.za')
private=root/'private'
private.mkdir(mode=0o700,exist_ok=True)
hook={'selfservice':{'flows':{'login':{'after':{'password':{'hooks':[
  {'hook':'require_verified_address'},
  {'hook':'web_hook','config':{'url':'http://app:3042/api/internal/kratos/after-login','method':'POST','body':'file:///etc/config/kratos/after-login.jsonnet','auth':{'type':'api_key','config':{'name':'X-Kratos-Hook-Secret','value':values['KRATOS_HOOK_SECRET'],'in':'header'}},'can_interrupt':False,'response':{'ignore':True,'parse':False}}}
]}}}}}}
# The containing directory is root-only; this single file is mounted read-only for Kratos UID 10000.
(private/'kratos.local.json').write_text(json.dumps(hook))
os.chmod(private/'kratos.local.json',0o644)
fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
    for k,v in values.items():f.write(f'{k}={json.dumps(v)}\n')
print('Fleet server configuration initialized; credentials remain in /opt/fleet/.env.')
