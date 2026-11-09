import dataSource from './data-source.js';
import { configureRepairAudit } from '../issues/repair-audit.js';
try {
  await dataSource.initialize();
  await configureRepairAudit(dataSource);
  console.log('Disabled WhatsApp repair audit identity is ready.');
} catch {
  console.error('Could not prepare the disabled repair audit identity.');
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
