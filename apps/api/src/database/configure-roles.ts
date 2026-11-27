import { configureRoles } from '../modules/identity/domain/permissions.js';
import { withMaintenanceOrm } from './orm.js';

// Update role data in the app schema; schema changes belong in migrations.
try {
  await withMaintenanceOrm(async (orm) => {
    await orm.em.fork().transactional((tx) => configureRoles(tx));
  });
  console.log('Role catalogue is ready.');
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Role configuration failed.',
  );
  process.exitCode = 1;
}
