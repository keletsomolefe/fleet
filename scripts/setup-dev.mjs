import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = new URL('../', import.meta.url);
const envFile = new URL('.env', root);
let text;
try {
  text = await readFile(envFile, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  text = await readFile(new URL('.env.sample', root), 'utf8');
}

const values = parseEnv(text);
function setDefault(name, value) {
  if (values[name]) return;
  values[name] = String(value);
  const line = `${name}=${JSON.stringify(String(value))}`;
  const expression = new RegExp(`^${name}=.*$`, 'm');
  text = expression.test(text)
    ? text.replace(expression, () => line)
    : `${text.trimEnd()}\n${line}\n`;
}

for (const [name, value] of Object.entries({
  POSTGRES_PORT: 55432,
  POSTGRES_DB: 'fleet',
  POSTGRES_USER: 'fleet_admin',
  APP_DB_USER: 'fleet_app',
  KRATOS_DB_USER: 'fleet_kratos',
  KRATOS_PORT: 14433,
  KRATOS_ADMIN_PORT: 14434,
  KRATOS_UI_PORT: 14455,
  MAILPIT_PORT: 18025,
  MQTT_ENABLED: 'true',
  MQTT_WS_PORT: 1884,
  MQTT_BIND_HOST: '127.0.0.1',
})) setDefault(name, value);

for (const name of [
  'APP_CSRF_SECRET',
  'KRATOS_HOOK_SECRET',
  'POSTGRES_PASSWORD',
  'APP_DB_PASSWORD',
  'KRATOS_DB_PASSWORD',
  'KRATOS_COOKIE_SECRET',
  'KRATOS_UI_COOKIE_SECRET',
  'KRATOS_UI_CSRF_SECRET',
]) setDefault(name, randomBytes(32).toString('hex'));
// XChaCha20-Poly1305 requires exactly 32 bytes, not a 64-character hex key.
setDefault('KRATOS_CIPHER_SECRET', randomBytes(24).toString('base64url'));

const roles = [values.POSTGRES_USER, values.APP_DB_USER, values.KRATOS_DB_USER];
if (new Set(roles).size !== roles.length) {
  throw new Error('PostgreSQL administrator, app and Kratos roles must be distinct.');
}

setDefault('KRATOS_PUBLIC_URL', `http://127.0.0.1:${values.KRATOS_PORT}/`);
setDefault('KRATOS_ADMIN_URL', `http://127.0.0.1:${values.KRATOS_ADMIN_PORT}/`);
setDefault('KRATOS_UI_URL', `http://127.0.0.1:${values.KRATOS_UI_PORT}/`);
setDefault('APP_URL', `http://127.0.0.1:${values.GATEWAY_PORT || 3042}/`);
setDefault('MQTT_PUBLIC_URL', `ws://127.0.0.1:${values.MQTT_WS_PORT}/mqtt`);
setDefault('KRATOS_HOOK_URL', `http://host.docker.internal:${values.GATEWAY_PORT || 3042}/api/internal/kratos/after-login`);
setDefault('DATABASE_SCHEMA', 'app');
setDefault('DATABASE_URL', `postgres://${encodeURIComponent(values.APP_DB_USER)}:${encodeURIComponent(values.APP_DB_PASSWORD)}@127.0.0.1:${values.POSTGRES_PORT}/${encodeURIComponent(values.POSTGRES_DB)}?sslmode=disable`);
setDefault('KRATOS_DSN', `postgres://${encodeURIComponent(values.KRATOS_DB_USER)}:${encodeURIComponent(values.KRATOS_DB_PASSWORD)}@postgres:5432/${encodeURIComponent(values.POSTGRES_DB)}?sslmode=disable&search_path=kratos,extensions&max_conns=10&max_idle_conns=2`);

await writeFile(envFile, text, { mode: 0o600 });
await chmod(envFile, 0o600);
// Kratos cannot decode an array of hook objects from an environment string.
// Keep the secret-bearing override local and mount it alongside the base config.
const hookFile = new URL('docker/kratos/kratos.local.json', root);
await writeFile(hookFile, JSON.stringify({ selfservice: { flows: { login: { after: { password: { hooks: [
  { hook: 'require_verified_address' },
  { hook: 'web_hook', config: { url: values.KRATOS_HOOK_URL, method: 'POST',
    body: 'file:///etc/config/kratos/after-login.jsonnet',
    auth: { type: 'api_key', config: { name: 'X-Kratos-Hook-Secret', value: values.KRATOS_HOOK_SECRET, in: 'header' } },
    can_interrupt: false, response: { ignore: true, parse: false } } },
] } } } } } }, null, 2), { mode: 0o600 });
await chmod(hookFile, 0o600);
console.log(`Local development configuration ready: ${fileURLToPath(envFile)}`);
console.log(`Fleet login: ${values.APP_URL}login`);
console.log(`Kratos: ${values.KRATOS_PUBLIC_URL}`);
console.log(`Email inbox: http://127.0.0.1:${values.MAILPIT_PORT}`);
