import { withMaintenanceDatabase } from './orm.js';

// Read-only deployment preflight. Pending application migrations run before this check.
// It compares mapped entity metadata with information_schema and never writes to the
// database (no create/alter/drop).
try {
  await withMaintenanceDatabase(async (db) => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'app'",
    );
    const existing = new Set(
      columns.map((column) => `${column.table_name}.${column.column_name}`),
    );
    const missing: string[] = [];
    for (const meta of Object.values(db.orm.getMetadata().getAll())) {
      for (const property of Object.values(meta.properties) as Array<{
        persist?: boolean;
        fieldNames?: string[];
      }>) {
        if (!property.persist || !property.fieldNames) continue;
        for (const fieldName of property.fieldNames) {
          if (!existing.has(`${meta.tableName}.${fieldName}`))
            missing.push(`${meta.tableName}.${fieldName}`);
        }
      }
    }
    if (missing.length)
      throw new Error(
        'The existing app schema is incomplete. Apply the application migrations and retry; deployment stopped without changing application data.',
      );
    console.log('Existing application schema is ready.');
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Application schema check failed.',
  );
  process.exitCode = 1;
}
