import { type MikroORM } from '@mikro-orm/postgresql';
import { databaseConfig } from './database.config.js';
import { Database } from './database.js';

/**
 * Initializes the ORM and exposes the application database wrapper.
 * `maintenance` keeps the connection pool small for one-shot scripts.
 */
export async function createDatabase(
  maintenance = false,
): Promise<{ orm: MikroORM; db: Database }> {
  const { MikroORM: Mikro } = await import('@mikro-orm/postgresql');
  const orm = await Mikro.init(databaseConfig(maintenance) as never);
  return { orm, db: new Database(orm) };
}

/** Boots a maintenance script, runs it and always closes the pool. */
export async function withMaintenanceDatabase<T>(
  work: (db: Database, orm: MikroORM) => Promise<T>,
): Promise<T> {
  const { orm, db } = await createDatabase(true);
  try {
    return await work(db, orm);
  } finally {
    await db.close();
  }
}
