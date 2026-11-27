// CLI entry point: `pnpm --filter api exec mikro-orm ...` (run from apps/api).
// The runtime creates the ORM from the same configuration object.
import type { Options } from '@mikro-orm/postgresql';
import { databaseConfig } from './src/database/database.config.js';

const config: Options = databaseConfig();
export default config;
