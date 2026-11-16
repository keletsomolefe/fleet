import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'fleet-deploy-safety-'));
try {
  const env = join(dir, '.env');
  const original = 'DATABASE_URL=keep-existing\nKRATOS_SECRET=keep-existing\nSERVICE_JOB_LINK_SECRET=\n';
  writeFileSync(env, original, { mode: 0o600 });
  const init = () => execFileSync('python3', ['deploy/init-messaging.py', env], { encoding: 'utf8' });
  const output = init();
  const once = readFileSync(env, 'utf8');
  assert.ok(once.startsWith(original.split('SERVICE_JOB_LINK_SECRET=')[0]));
  assert.match(once, /^SERVICE_JOB_ALERTS_ENABLED=false$/m);
  for (const key of ['SERVICE_JOB_LINK_SECRET', 'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN']) {
    const value = once.match(new RegExp(`^${key}=(.+)$`, 'm'))[1];
    assert.ok(value.length >= 32);
    assert.ok(!output.includes(value));
  }
  init();
  assert.equal(readFileSync(env, 'utf8'), once);
  assert.equal(statSync(env).mode & 0o777, 0o600);
  console.log('PASS deployment preserves existing credentials and messaging keys; messaging starts disabled');
  const deploy = readFileSync('deploy/deploy.sh', 'utf8');
  assert.doesNotMatch(deploy, /prepare_launch_baseline|prepare-baseline|migration:run|DROP SCHEMA|down -v/);
  assert.ok(deploy.indexOf('database/migrate.js') < deploy.indexOf('database/check-schema.js'));
  assert.ok(deploy.indexOf('database/check-schema.js') < deploy.indexOf('database/configure-roles.js'));
  assert.ok(deploy.indexOf('database/check-schema.js') < deploy.indexOf('rollout()'));
  const config = readFileSync('apps/api/src/database/database.config.ts', 'utf8');
  assert.match(config, /tableName: 'mikro_orm_migrations'/);
  assert.match(config, /schema: 'app'/);
  assert.match(config, /dropTables: false/);
  assert.match(config, /safe: true/);
  assert.match(config, /namingStrategy: EntityCaseNamingStrategy/);
  assert.match(config, /allowGlobalContext: false/);
  assert.doesNotMatch(config, /synchronize: true/);
  console.log('PASS deployment checks existing schema before rollout and never resets application data');
} finally { rmSync(dir, { recursive: true, force: true }); }
