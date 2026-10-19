import assert from 'node:assert/strict';
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { setTimeout } from 'node:timers/promises';

const root = new URL('../', import.meta.url);
const env = parseEnv(await readFile(new URL('.env', root), 'utf8'));
const require = createRequire(new URL('apps/api/package.json', root));
const { Client } = require('pg');
const db = new Client({ connectionString: env.DATABASE_URL });
const app = new URL(env.APP_URL);
const publicUrl = new URL(env.KRATOS_PUBLIC_URL);
const adminUrl = new URL(env.KRATOS_ADMIN_URL);
const inbox = new URL(`http://127.0.0.1:${env.MAILPIT_PORT}/`);
const identities = new Set();
const emails = new Set();
const password = randomBytes(24).toString('base64url');
const cookies = new Map();
const cookie = jar => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
const pass = label => console.log(`PASS ${label}`);

async function request(base, path, options = {}, jar) {
  const response = await fetch(new URL(path, base), { ...options, redirect: 'manual',
    signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json',
      ...(jar ? { Cookie: cookie(jar) } : {}), ...options.headers } });
  if (jar) for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0]; const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, headers: response.headers };
}
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function login(email, credential, jar) {
  const flow = await request(publicUrl, 'self-service/login/browser', {}, jar);
  assert.equal(flow.status, 200, 'Initialize browser login');
  const csrf = flow.body.ui.nodes.find(n => n.attributes.name === 'csrf_token')?.attributes.value;
  assert.ok(csrf);
  const missing = await request(publicUrl, flow.body.ui.action, json({ method: 'password', identifier: email, password: credential }), jar);
  assert.ok([400, 403].includes(missing.status), 'Reject browser login without CSRF');
  return request(publicUrl, flow.body.ui.action, json({ method: 'password', identifier: email, password: credential, csrf_token: csrf }), jar);
}
async function createIdentity(email) {
  emails.add(email);
  const result = await request(adminUrl, 'admin/identities', json({ schema_id: 'fleet-user-v1',
    traits: { email, name: { first: 'Smoke', last: 'Test' } },
    credentials: { password: { config: { password } } },
    verifiable_addresses: [{ value: email, via: 'email', verified: true, status: 'completed', verified_at: new Date().toISOString() }] }));
  assert.equal(result.status, 201); identities.add(result.body.id); return result.body;
}

await db.connect();
try {
  assert.equal((await request(app, 'api/auth/session')).status, 401);
  assert.equal((await request(app, 'api/admin/users', json({}))).status, 401);
  assert.equal((await request(app, 'api/internal/kratos/after-login', json({}))).status, 401);
  const protectedPage = await request(app, 'admin/signup', { headers: { Accept: 'text/html' } });
  assert.equal(protectedPage.status, 307);
  assert.match(protectedPage.headers.get('location'), /login/);
  pass('Anonymous API and server-rendered admin protection');

  for (const hostname of ['127.0.0.1', 'localhost']) {
    const origin = new URL(app); origin.hostname = hostname;
    const flowCookies = new Map();
    const page = await request(origin, 'login', { headers: { Accept: 'text/html' } }, flowCookies);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('name="identifier"') && page.body.includes('name="password"'));
    assert.ok(page.body.includes('name="csrf_token"'));
    assert.ok(!page.body.includes('Preparing secure sign in'));
    assert.match(page.headers.get('cache-control'), /no-store/);
    assert.ok([...flowCookies.keys()].some(key => key.includes('csrf')));
    assert.ok(!page.body.includes('name="flow_id"'));
    const flowCookie = flowCookies.get('fleet_login_flow'); assert.ok(flowCookie);
    const encrypted = Buffer.from(flowCookie, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(env.APP_CSRF_SECRET).digest(), encrypted.subarray(0, 12));
    decipher.setAAD(Buffer.from('fleet-browser-flow:login')); decipher.setAuthTag(encrypted.subarray(12, 28));
    const { id } = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8'));
    assert.ok(!page.body.includes(id), 'Flow IDs are not serialized into the page');
    const restored = await request(origin, `login?flow=${id}`, { headers: { Accept: 'text/html' } }, flowCookies);
    assert.equal(restored.status, 307);
    assert.ok(!restored.headers.get('location').includes('flow='));
    const expired = await request(origin, 'login?flow=00000000-0000-0000-0000-000000000000', { headers: { Accept: 'text/html' } }, flowCookies);
    assert.equal(expired.status, 307);
    const refreshed = await request(origin, 'login', { headers: { Accept: 'text/html' } }, flowCookies);
    assert.ok(refreshed.body.includes('name="identifier"'));
    assert.ok(!refreshed.body.includes('This form expired'));
  }
  pass('Login forms render server-side with CSRF cookies on both local hosts; valid flows reload and expired flows restart');

  const result = await login(env.BOOTSTRAP_ADMIN_EMAIL, env.BOOTSTRAP_ADMIN_PASSWORD, cookies);
  assert.equal(result.status, 200, 'Default administrator login');
  assert.ok(cookies.has('fleet_kratos_session'));
  const session = await request(app, 'api/auth/session', {}, cookies);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.email, env.BOOTSTRAP_ADMIN_EMAIL);
  assert.ok(session.body.csrfToken);
  assert.match(session.headers.get('cache-control'), /no-store/);
  const owner = session.body.user;
  assert.ok(session.body.roles.some(role => role.key === 'owner'));
  assert.ok(session.body.permissions.includes('admin.access'));
  assert.equal(owner.userType, undefined);
  const row = (await db.query('SELECT * FROM app.users WHERE id=$1', [owner.id])).rows[0];
  assert.ok(row.lastLoginAt, 'Docker-to-host login hook updated the profile');
  pass('Default admin browser login, CSRF, HTTP-only cookie and real login hook');

  const email = `admin-smoke-${randomBytes(6).toString('hex')}@example.test`;
  emails.add(email);
  const data = { email, firstName: 'Smoke', lastName: 'Admin', password };
  const originHeaders = { 'Content-Type': 'application/json', Origin: app.origin };
  assert.equal((await request(app, 'api/admin/users', { ...json(data), headers: originHeaders }, cookies)).status, 403);
  const authorized = { ...originHeaders, 'X-CSRF-Token': session.body.csrfToken };
  assert.equal((await request(app, 'api/admin/users', { ...json(data), headers: { ...authorized, Origin: 'https://evil.example' } }, cookies)).status, 403);
  const created = await request(app, 'api/admin/users', { ...json(data), headers: authorized }, cookies);
  assert.equal(created.status, 201);
  identities.add(created.body.user.identityId);
  assert.equal(created.body.user.createdById, undefined);
  assert.equal(created.body.password, undefined);
  assert.equal((await request(app, 'api/auth/session', {}, cookies)).body.user.id, owner.id);
  assert.equal((await request(app, 'api/admin/users', { ...json(data), headers: authorized }, cookies)).status, 409);
  const localhostOrigin = new URL(app); localhostOrigin.hostname = 'localhost';
  assert.equal((await request(app, 'api/admin/users', { ...json(data), headers: { ...authorized, Origin: localhostOrigin.origin } }, cookies)).status, 409);
  const catalog = await request(app, 'api/admin/roles', {}, cookies);
  assert.equal(catalog.status, 200);
  const roleId = key => { const role = catalog.body.find(role => role.key === key); assert.ok(role); return role.id; };
  const targetId = created.body.user.id;
  const access = (id, keys, isActive = true, jar = cookies, headers = authorized) => request(app, `api/admin/users/${id}/access`,
    { method: 'PATCH', headers, body: JSON.stringify({ roleIds: keys.map(roleId), isActive }) }, jar);
  const list = await request(app, `api/admin/users?q=${encodeURIComponent(email)}`, {}, cookies);
  assert.equal(list.status, 200); assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].id, targetId); assert.deepEqual(list.body.items[0].roles, []);
  assert.equal((await request(app, 'api/admin/users?page=0', {}, cookies)).status, 400);
  assert.equal((await access(targetId, ['driver'], true, cookies, originHeaders)).status, 403);
  assert.equal((await access(owner.id, ['administrator'], false)).status, 409, 'Last active owner cannot be removed');
  assert.equal((await access(targetId, ['driver', 'terminal_operator'])).status, 200);
  pass('User creation grants no roles; list/search, CSRF-protected role assignment and last-owner protection');

  const newCookies = new Map();
  assert.equal((await login(email, password, newCookies)).status, 403, 'New account requires email verification');
  const verification = await request(publicUrl, 'self-service/verification/api');
  assert.equal(verification.status, 200);
  const sent = await request(publicUrl, verification.body.ui.action, json({ method: 'code', email }));
  assert.equal(sent.status, 200);
  let code;
  for (let attempt = 0; attempt < 20 && !code; attempt++) {
    const messages = await request(inbox, 'api/v1/messages');
    for (const message of messages.body.messages ?? []) {
      if (!message.To?.some(recipient => recipient.Address === email)) continue;
      const detail = await request(inbox, `api/v1/message/${message.ID}`);
      if (detail.body.Text?.includes(verification.body.id)) code = detail.body.Text.match(/\b\d{6}\b/)?.[0];
      if (code) break;
    }
    if (!code) await setTimeout(500);
  }
  assert.ok(code, 'Verification email arrived');
  assert.equal((await request(publicUrl, verification.body.ui.action, json({ method: 'code', code }))).status, 200);
  assert.equal((await login(email, password, newCookies)).status, 200);
  assert.equal((await request(app, 'api/auth/session', {}, newCookies)).status, 403, 'Driver/terminal users have no admin access');
  assert.equal((await access(targetId, ['driver', 'dispatcher'])).status, 200);
  const dispatchSession = await request(app, 'api/auth/session', {}, newCookies);
  assert.equal(dispatchSession.status, 200);
  assert.ok(dispatchSession.body.permissions.includes('driver.access'));
  assert.ok(dispatchSession.body.permissions.includes('dispatch.read'));
  assert.ok(!dispatchSession.body.permissions.includes('users.read'));
  assert.equal((await request(app, 'api/admin/users', {}, newCookies)).status, 403);
  assert.equal((await request(app, 'api/admin/roles', {}, newCookies)).status, 403);
  assert.equal((await request(app, 'api/admin/users', { ...json({ ...data, email: 'denied@example.test' }), headers: { ...originHeaders, 'X-CSRF-Token': dispatchSession.body.csrfToken } }, newCookies)).status, 403);
  for (const path of ['admin/users', 'admin/users/new', 'admin/roles', 'admin/exports']) {
    const denied = await request(app, path, { headers: { Accept: 'text/html' } }, newCookies);
    assert.equal(denied.status, 403, `Direct SSR permission protection: ${path}`);
    assert.ok(!denied.body.includes(env.BOOTSTRAP_ADMIN_EMAIL), 'User roster is not leaked');
  }
  const dispatchPage = await request(app, 'admin/dispatch', { headers: { Accept: 'text/html' } }, newCookies);
  assert.equal(dispatchPage.status, 200);
  assert.ok(!dispatchPage.body.includes('>Roles &amp; permissions<'));
  assert.equal((await access(targetId, ['driver', 'administrator'])).status, 200);
  const adminSession = await request(app, 'api/auth/session', {}, newCookies);
  assert.equal(adminSession.status, 200);
  assert.ok(adminSession.body.permissions.includes('driver.access'));
  assert.ok(adminSession.body.permissions.includes('users.access'));
  const adminHeaders = { ...originHeaders, 'X-CSRF-Token': adminSession.body.csrfToken };
  assert.equal((await access(targetId, ['owner'], true, newCookies, adminHeaders)).status, 403, 'Administrator cannot promote themselves to owner');
  assert.equal((await access(owner.id, ['administrator'], true, newCookies, adminHeaders)).status, 403, 'Administrator cannot change owner access');
  assert.equal((await access(targetId, [], true)).status, 200);
  assert.equal((await request(app, 'api/auth/session', {}, newCookies)).status, 403, 'Role revocation takes effect on the next request');
  assert.equal((await access(targetId, ['administrator', 'driver'])).status, 200);
  pass('Verified user with combined roles; API/SSR permission enforcement, no owner escalation and immediate revocation');

  await db.query('UPDATE app.users SET "isActive"=false WHERE "kratosIdentityId"=$1', [created.body.user.identityId]);
  assert.equal((await request(app, 'api/auth/session', {}, newCookies)).status, 403);
  await access(targetId, ['driver'], true);
  assert.equal((await request(app, 'api/auth/session', {}, newCookies)).status, 403);
  const outsiderEmail = `outsider-smoke-${randomBytes(6).toString('hex')}@example.test`;
  await createIdentity(outsiderEmail);
  const outsider = new Map(); assert.equal((await login(outsiderEmail, password, outsider)).status, 200);
  assert.equal((await request(app, 'api/auth/session', {}, outsider)).status, 403);
  pass('Inactive users, driver-only users and Kratos-only identities cannot access admin');

  const oldAt = new Date(Date.now() + 60_000);
  await db.query('UPDATE app.users SET "lastLoginAt"=$1 WHERE "kratosIdentityId"=$2', [oldAt, created.body.user.identityId]);
  const hookBody = { identity: { id: created.body.user.identityId, traits: { email, name: { first: 'Smoke', last: 'Admin' } } }, authenticated_at: oldAt.toISOString() };
  for (const authenticated_at of [oldAt.toISOString(), '2000-01-01T00:00:00Z']) {
    const hook = await request(app, 'api/internal/kratos/after-login', { ...json({ ...hookBody, authenticated_at }),
      headers: { 'Content-Type': 'application/json', 'X-Kratos-Hook-Secret': env.KRATOS_HOOK_SECRET } });
    assert.equal(hook.status, 204);
  }
  assert.equal((await db.query('SELECT "lastLoginAt" FROM app.users WHERE "kratosIdentityId"=$1', [created.body.user.identityId])).rows[0].lastLoginAt.toISOString(), oldAt.toISOString());
  pass('Authenticated hook replay does not regress login timestamps');

  const logout = await request(publicUrl, 'self-service/logout/browser', {}, cookies);
  assert.equal(logout.status, 200);
  await request(publicUrl, logout.body.logout_url, {}, cookies);
  assert.equal((await request(app, 'api/auth/session', {}, cookies)).status, 401);
  pass('Browser logout invalidates the administrator session');
} finally {
  for (const id of identities) {
    await db.query('DELETE FROM app.users WHERE "kratosIdentityId"=$1', [id]);
    await request(adminUrl, `admin/identities/${id}`, { method: 'DELETE' });
  }
  const messages = await request(inbox, 'api/v1/messages');
  const ids = (messages.body.messages ?? []).filter(m => m.To?.some(r => emails.has(r.Address))).map(m => m.ID);
  if (ids.length) await request(inbox, 'api/v1/messages', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
  await db.end();
}
