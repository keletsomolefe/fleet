import { create } from '@platformatic/runtime';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
// Keep app source watching and load Watt's root configuration once at startup.
const config = JSON.parse(await readFile(new URL('watt.json', root), 'utf8'));
await create(fileURLToPath(root), config, { start: true, production: false });
