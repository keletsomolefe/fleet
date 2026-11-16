import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'fleet-deploy-safety-'));
try {
  const env = join(dir, '.env');
  const original = 'DATABASE_URL=keep-existing\nKRATOS_SECRET=keep-existing\nREPAIR_LINK_SECRET=\n';
  writeFileSync(env, original, { mode: 0o600 });
  const init = () => execFileSync('python3', ['deploy/init-repairs.py', env], { encoding: 'utf8' });
  const output = init();
  const once = readFileSync(env, 'utf8');
  assert.ok(once.startsWith(original.split('REPAIR_LINK_SECRET=')[0]));
  assert.match(once, /^WHATSAPP_ENABLED=false$/m);
  for (const key of ['REPAIR_LINK_SECRET', 'OPENWA_MASTER_KEY', 'OPENWA_KEY_PEPPER']) {
    const value = once.match(new RegExp(`^${key}=(.+)$`, 'm'))[1];
    assert.ok(value.length >= 32);
    assert.ok(!output.includes(value));
  }
  init();
  assert.equal(readFileSync(env, 'utf8'), once);
  assert.equal(statSync(env).mode & 0o777, 0o600);
  console.log('PASS deployment preserves existing credentials and repair keys; messaging starts disabled');
  const deploy = readFileSync('deploy/deploy.sh', 'utf8');
  assert.doesNotMatch(deploy, /prepare_launch_baseline|prepare-baseline|migration:run|DROP SCHEMA|down -v/);
  assert.ok(deploy.indexOf('database/check-schema.js') < deploy.indexOf('database/configure-roles.js'));
  assert.ok(deploy.indexOf('database/check-schema.js') < deploy.indexOf('rollout()'));
  const config = readFileSync('apps/api/src/database/database.config.ts', 'utf8');
  assert.match(config, /migrations: \[\]/);
  assert.match(config, /synchronize: false/);
  assert.match(config, /migrationsRun: false/);
  console.log('PASS deployment checks existing schema before rollout and never resets application data');
} finally { rmSync(dir, { recursive: true, force: true }); }
