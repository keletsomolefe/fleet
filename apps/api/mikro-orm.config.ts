// CLI entry point: `pnpm --filter api exec mikro-orm ...` (run from apps/api).
// The runtime creates the ORM from the same configuration object.
import { databaseConfig } from './src/database/database.config.js';

export default databaseConfig();
