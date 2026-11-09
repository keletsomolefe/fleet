import dataSource from './data-source.js';

// Read-only deployment preflight. App migrations are deferred; never create or reset a schema.
try {
  await dataSource.initialize();
  const columns: Array<{ table_name: string; column_name: string }> =
    await dataSource.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'app'",
    );
  const existing = new Set(
    columns.map((c) => `${c.table_name}.${c.column_name}`),
  );
  const missing = dataSource.entityMetadatas.flatMap((entity) =>
    entity.columns
      .filter(
        (column) => !existing.has(`${entity.tableName}.${column.databaseName}`),
      )
      .map((column) => `${entity.tableName}.${column.databaseName}`),
  );
  if (missing.length)
    throw new Error(
      'The existing app schema is incomplete. Application migrations are deferred; deployment stopped without changing application data.',
    );
  console.log('Existing application schema is ready.');
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Application schema check failed.',
  );
  process.exitCode = 1;
} finally {
  if (dataSource.isInitialized) await dataSource.destroy();
}
