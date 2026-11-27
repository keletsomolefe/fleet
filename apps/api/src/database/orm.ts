import { MikroORM } from '@mikro-orm/postgresql';
import { databaseConfig } from './database.config.js';

/**
 * Initializes MikroORM for runtime or maintenance scripts.
 * `maintenance` keeps the connection pool small (max 2) for one-shot CLIs.
 */
export async function createOrm(maintenance = false): Promise<MikroORM> {
  return MikroORM.init(databaseConfig(maintenance));
}

/** Boots a maintenance script with a small pool and always closes it cleanly. */
export async function withMaintenanceOrm<T>(
  work: (orm: MikroORM) => Promise<T>,
): Promise<T> {
  const orm = await createOrm(true);
  try {
    return await work(orm);
  } finally {
    await orm.close(true);
  }
}
