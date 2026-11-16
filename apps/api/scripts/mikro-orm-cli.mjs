// MikroORM CLI wrapper: loads the repository .env (MikroORM needs DATABASE_URL
// to resolve the config) and forwards all arguments to the CLI.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const env = parseEnv(readFileSync(new URL('../../../.env', import.meta.url), 'utf8'));
Object.assign(process.env, env);
const cli = fileURLToPath(new URL('../node_modules/.bin/mikro-orm', import.meta.url));
const child = spawn(cli, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
