import { withMaintenanceDatabase } from './orm.js';
import { configureRoles } from '../rbac/role-catalogue.js';

// Update role data in the app schema; schema changes belong in migrations.
try {
  await withMaintenanceDatabase(async (db) => {
    await db.transaction((em) => configureRoles(em));
  });
  console.log('Role catalogue is ready.');
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Role configuration failed.',
  );
  process.exitCode = 1;
}
