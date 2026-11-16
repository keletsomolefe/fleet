import { withMaintenanceDatabase } from './orm.js';

// Applies pending MikroORM migrations to the app schema. Idempotent: a second
// run reports that the schema is already up to date. The schema is created when
// missing so a fresh database can be initialized without any manual SQL.
try {
  await withMaintenanceDatabase(async (db) => {
    const em = db.fork();
    const schema = await em.query(
      "select 1 from information_schema.schemata where schema_name = 'app'",
    );
    if (!schema.length)
      throw new Error(
        'The app schema is missing. Create it first as a database administrator (CREATE SCHEMA app AUTHORIZATION <app_user>); migrations never create or drop it automatically.',
      );
    const applied = await db.orm.migrator.up();
    if (applied.length)
      console.log(
        `Applied ${applied.length} application migration${applied.length === 1 ? '' : 's'}.`,
      );
    else console.log('Application schema is up to date.');
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Application migration failed.',
  );
  process.exitCode = 1;
}
