import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'fleet-download-test-'));
const downloads = join(directory, 'downloads');
mkdirSync(join(downloads, 'android', 'releases'), { recursive: true });
mkdirSync(join(downloads, 'incoming'));
const data = Buffer.concat([
  Buffer.from([0x50, 0x4b, 3, 4]),
  Buffer.from('test-android-package'),
]);
const digest = createHash('sha256').update(data).digest('hex');
writeFileSync(join(downloads, 'incoming', `${digest}.apk`), data);
let container;
try {
  container = execFileSync('docker', [
    'run', '--rm', '-d', '-p', '127.0.0.1::8080',
    '-v', `${join(root, 'deploy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    '-v', `${join(root, 'deploy/publish-android.sh')}:/test/publish-android.sh:ro`,
    '-v', `${downloads}:/srv/downloads:ro`,
    '-v', `${downloads}:/opt/fleet/downloads`,
    'caddy:2.11.7-alpine',
  ], { encoding: 'utf8' }).trim();
  const port = execFileSync('docker', ['port', container, '8080/tcp'], {
    encoding: 'utf8',
  }).trim().split(':').at(-1);
  const url = `http://127.0.0.1:${port}/downloads/android/latest.apk`;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(url);
      ready = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready, 'download server starts');
  assert.equal((await fetch(url)).status, 404);
  execFileSync('docker', [
    'exec', container, 'sh', '/test/publish-android.sh', digest,
  ], { stdio: 'pipe' });
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(head.headers.get('content-length'), String(data.length));
  assert.equal(head.headers.get('cache-control'), 'no-cache');
  assert.match(head.headers.get('content-disposition'), /attachment; filename=vhh-fleet-staging.apk/);
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), data);
  const range = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), data.subarray(0, 4));
  const badDigest = 'a'.repeat(64);
  writeFileSync(join(downloads, 'incoming', `${badDigest}.apk`), data);
  assert.throws(() => execFileSync('docker', [
    'exec', container, 'sh', '/test/publish-android.sh', badDigest,
  ], { stdio: 'pipe' }));
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), data);
  console.log('PASS atomic APK publication, rejected checksum, GET/HEAD, attachment headers and resumable downloads');
} finally {
  if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'pipe' });
  rmSync(directory, { recursive: true, force: true });
}
