import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function privateDataDir(): string {
  if (process.env.NODE_ENV === 'production' && !process.env.FLEET_DATA_DIR)
    throw new Error(
      'FLEET_DATA_DIR must point to persistent private storage.',
    );
  return process.env.FLEET_DATA_DIR
    ? resolve(process.env.FLEET_DATA_DIR)
    : fileURLToPath(new URL('../../../../.fleet-data/', import.meta.url));
}

export function repairDataDir(): string {
  return join(privateDataDir(), 'repairs');
}

export function serviceJobDir(jobId: string): string {
  return join(privateDataDir(), 'service-jobs', jobId);
}

export async function writePrivateJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

export async function ensurePrivateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

export async function writePrivateFile(
  path: string,
  buffer: Buffer,
): Promise<void> {
  await writeFile(path, buffer, { mode: 0o600, flag: 'wx' });
}

export function readPrivateFile(path: string): Promise<Buffer> {
  return readFile(path);
}
