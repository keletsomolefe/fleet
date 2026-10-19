import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const env = parseEnv(await readFile(new URL('.env', root), 'utf8'));
const publicUrl = new URL(env.KRATOS_PUBLIC_URL);
const adminUrl = new URL(env.KRATOS_ADMIN_URL);
const inboxUrl = new URL(`http://127.0.0.1:${env.MAILPIT_PORT}/`);
const quote = value => `'${value.replaceAll("'", "''")}'`;

function sql(query, role = 'admin') {
  const user = role === 'admin' ? 'POSTGRES_USER' : role === 'app' ? 'APP_DB_USER' : 'KRATOS_DB_USER';
  const password = role === 'admin' ? 'POSTGRES_PASSWORD' : role === 'app' ? 'APP_DB_PASSWORD' : 'KRATOS_DB_PASSWORD';
  return execFileSync('docker', [
    'compose', 'exec', '-T', 'postgres', 'sh', '-c',
    `export PGPASSWORD="$${password}"; exec psql -h 127.0.0.1 -U "$${user}" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1`,
  ], { cwd: fileURLToPath(root), input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

async function request(base, path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json', ...options.headers },
  });
  const text = await response.text();
  const body = text && response.headers.get('content-type')?.includes('application/json')
    ? JSON.parse(text)
    : text || undefined;
  return { status: response.status, body, headers: response.headers };
}

async function submit(flow, body) {
  return request(publicUrl, flow.ui.action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function flow(kind) {
  const result = await request(publicUrl, `self-service/${kind}/api`);
  assert.equal(result.status, 200, `Initialize ${kind} flow`);
  return result.body;
}

function success(label) { console.log(`PASS ${label}`); }

assert.equal(sql('SELECT current_schema();', 'app'), 'app');
assert.equal(sql('SELECT current_schema();', 'kratos'), 'kratos');
for (const [user, own, other] of [
  [env.APP_DB_USER, 'app', 'kratos'],
  [env.KRATOS_DB_USER, 'kratos', 'app'],
]) {
  assert.equal(sql(`SELECT
    has_schema_privilege(${quote(user)}, ${quote(own)}, 'CREATE')
    AND NOT has_schema_privilege(${quote(user)}, ${quote(other)}, 'USAGE')
    AND NOT has_schema_privilege(${quote(user)}, 'public', 'CREATE')
    AND NOT has_schema_privilege(${quote(user)}, 'extensions', 'CREATE')
    AND NOT has_database_privilege(${quote(user)}, current_database(), 'CREATE')
    AND NOT (SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = ${quote(user)});`), 't');
}
assert.equal(sql(`SELECT to_regclass('kratos.identities') IS NOT NULL
  AND to_regclass('kratos.sessions') IS NOT NULL
  AND to_regclass('kratos.schema_migration') IS NOT NULL
  AND to_regclass('public.identities') IS NULL
  AND (SELECT count(*) = 2 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname IN ('pg_trgm', 'btree_gin') AND n.nspname = 'extensions');`), 't');
// A real application-role write must land in app and roll back without leftovers.
assert.match(sql('BEGIN; CREATE TABLE fleet_schema_probe (id integer); SELECT table_schema FROM information_schema.tables WHERE table_name = \'fleet_schema_probe\'; ROLLBACK;', 'app'), /\bapp\b/);
success('PostgreSQL role isolation, schema search paths, extensions and Kratos migrations');

assert.equal((await request(adminUrl, 'health/ready')).status, 200);
assert.equal((await request(publicUrl, 'sessions/whoami')).status, 401);
success('Kratos readiness and rejection of anonymous sessions');

const email = `fleet-smoke-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(24).toString('base64url');
const messageIds = new Set();
let identityId;
try {
  const registration = await submit(await flow('registration'), {
    method: 'password', password,
    traits: { email, name: { first: 'Development', last: 'Smoke test' } },
  });
  identityId = registration.body?.identity?.id;
  // Keep cleanup possible even when a future flow response changes shape.
  if (!identityId) {
    const identities = await request(adminUrl, `admin/identities?credentials_identifier=${encodeURIComponent(email)}`);
    identityId = identities.body?.find(identity => identity.traits.email === email)?.id;
  }
  assert.equal(registration.status, 200, `Registration returned ${registration.status}`);
  assert.ok(identityId, 'Registration created a persisted identity');
  assert.equal(sql(`SELECT count(*) FROM kratos.identities WHERE id = ${quote(identityId)};`), '1');
  success('Registration persists the identity in the kratos schema');

  const unverified = await submit(await flow('login'), { method: 'password', identifier: email, password });
  assert.equal(unverified.status, 403, 'Unverified email cannot log in');
  assert.equal(unverified.body?.session_token, undefined);
  success('Login requires a verified email address');

  const verification = await flow('verification');
  const sent = await submit(verification, { method: 'code', email });
  assert.equal(sent.status, 200);
  let code;
  for (let attempt = 0; attempt < 30 && !code; attempt++) {
    const messages = await request(inboxUrl, 'api/v1/messages');
    for (const summary of messages.body.messages ?? []) {
      if (!summary.To?.some(recipient => recipient.Address === email)) continue;
      messageIds.add(summary.ID);
      const message = await request(inboxUrl, `api/v1/message/${summary.ID}`);
      if (!message.body.Text?.includes(verification.id)) continue;
      code = message.body.Text.match(/\b\d{6}\b/)?.[0];
      if (code) break;
    }
    if (!code) await setTimeout(1_000);
  }
  assert.ok(code, 'Verification email arrived in Mailpit');
  const verified = await submit(verification, { method: 'code', code });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.state, 'passed_challenge');
  success('Courier email delivery and self-service verification');

  const login = await submit(await flow('login'), { method: 'password', identifier: email, password });
  assert.equal(login.status, 200);
  assert.ok(login.body.session_token, 'Login returns a session token');
  const whoami = await request(publicUrl, 'sessions/whoami', { headers: { 'X-Session-Token': login.body.session_token } });
  assert.equal(whoami.status, 200);
  assert.equal(whoami.body.identity.id, identityId);
  success('Verified user login and session validation');

  const browser = await request(publicUrl, 'self-service/login/browser');
  assert.equal(browser.status, 200);
  const csrfCookies = browser.headers.getSetCookie().map(cookie => cookie.split(';')[0]);
  const csrfToken = browser.body.ui.nodes.find(node => node.attributes.name === 'csrf_token')?.attributes.value;
  assert.ok(csrfToken, 'Browser login includes a CSRF token');
  const page = await fetch(new URL(`login?flow=${browser.body.id}`, env.KRATOS_UI_URL), {
    headers: { Cookie: csrfCookies.join('; ') }, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /name="csrf_token"/);
  const missingCsrf = await request(publicUrl, browser.body.ui.action, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: csrfCookies.join('; ') },
    body: JSON.stringify({ method: 'password', identifier: email, password }),
  });
  assert.ok([400, 403].includes(missingCsrf.status), 'Browser login rejects a missing CSRF token');
  const browserLogin = await request(publicUrl, browser.body.ui.action, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: csrfCookies.join('; ') },
    body: JSON.stringify({ method: 'password', identifier: email, password, csrf_token: csrfToken }),
  });
  assert.equal(browserLogin.status, 200);
  const sessionCookie = browserLogin.headers.getSetCookie().find(cookie => cookie.startsWith('fleet_kratos_session='));
  assert.ok(sessionCookie, 'Browser login sets the Fleet session cookie');
  assert.match(sessionCookie, /HttpOnly/i);
  assert.equal((await request(publicUrl, 'sessions/whoami', { headers: { Cookie: sessionCookie.split(';')[0] } })).status, 200);
  success('Reference login UI, browser CSRF protection and HTTP-only session cookie');

  const logout = await request(publicUrl, 'self-service/logout/api', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: login.body.session_token }),
  });
  assert.equal(logout.status, 204);
  assert.equal((await request(publicUrl, 'sessions/whoami', { headers: { 'X-Session-Token': login.body.session_token } })).status, 401);
  success('Logout invalidates the session');
} finally {
  if (identityId) {
    const deleted = await request(adminUrl, `admin/identities/${identityId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204, 'Remove only the smoke test identity');
  }
  const messages = await request(inboxUrl, 'api/v1/messages');
  for (const message of messages.body.messages ?? []) {
    if (message.To?.some(recipient => recipient.Address === email)) messageIds.add(message.ID);
  }
  if (messageIds.size) {
    await request(inboxUrl, 'api/v1/messages', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: [...messageIds] }),
    });
  }
}
