import dataSource from './data-source.js';
import { configureRoles } from '../rbac/configure-roles.js';

try {
  await dataSource.initialize();
  await configureRoles(dataSource);
  console.log(
    'Roles updated. Dispatcher and Terminal operator retired. Truck mechanic can view and resolve issues.',
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Role configuration failed.',
  );
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
