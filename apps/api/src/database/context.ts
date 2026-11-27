import {
  type EntityManager,
  type MikroORM,
  RequestContext,
} from '@mikro-orm/postgresql';

/**
 * Returns the current request-scoped MikroORM EntityManager, or creates a
 * fresh fork when called outside an HTTP RequestContext (background workers,
 * MQTT callbacks, maintenance scripts, or direct service tests).
 *
 * The global EntityManager stays disabled (`allowGlobalContext: false`).
 */
export function getEm(orm: MikroORM): EntityManager {
  return (
    (RequestContext.getEntityManager() as EntityManager | undefined) ??
    orm.em.fork()
  );
}

function toPgArray(values: unknown[]): string {
  return (
    '{' +
    values
      .map((value) => {
        if (value === null || value === undefined) return 'NULL';
        const text =
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
        return (
          '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
        );
      })
      .join(',') +
    '}'
  );
}

/**
 * Translates PostgreSQL `$1` placeholders into `?` placeholders for MikroORM's
 * `em.execute()`, duplicating repeated positional parameters and serializing
 * array parameters as PostgreSQL array literals.
 */
function prepareSql(sql: string, params: unknown[] = []): [string, unknown[]] {
  if (!params.length || !/\$\d+/.test(sql)) {
    return [
      sql,
      params.map((value) => (Array.isArray(value) ? toPgArray(value) : value)),
    ];
  }
  const ordered: unknown[] = [];
  let sequential = 0;
  const translated = sql.replace(
    /\$(\d+)|\?/g,
    (_match: string, index?: string) => {
      const value = index ? params[Number(index) - 1] : params[sequential++];
      ordered.push(Array.isArray(value) ? toPgArray(value) : value);
      return '?';
    },
  );
  return [translated, ordered];
}

/** Executes parameterized raw SQL through a native MikroORM EntityManager. */
export async function rawQuery<Row = Record<string, unknown>>(
  em: EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> {
  const [text, values] = prepareSql(sql, params);
  return (await em.execute(text, values as never[])) as Row[];
}

/**
 * Takes a transaction-scoped PostgreSQL advisory lock. Must be called inside
 * `em.transactional(...)`.
 */
export async function acquireAdvisoryLock(
  em: EntityManager,
  key:
    | 'fleet-assets-v1'
    | 'fleet-user-access-v1'
    | 'fleet-development-admin-v1'
    | 'fleet-initial-owner-v1'
    | 'fleet-transport-rates-v1'
    | 'fleet-transport-records-v1',
): Promise<void> {
  await em.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [key]);
}

/** Returns PostgreSQL's current `clock_timestamp()` inside a transaction. */
export async function dbClockTimestamp(em: EntityManager): Promise<Date> {
  const rows = (await em.execute('SELECT clock_timestamp() AS at')) as Array<{
    at: Date;
  }>;
  return rows[0].at;
}

/** Extracts the PostgreSQL SQLSTATE code (e.g. `23505`) from a MikroORM/pg error. */
export function pgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; cause?: { code?: unknown } };
  if (typeof record.code === 'string') return record.code;
  if (typeof record.cause?.code === 'string') return record.cause.code;
  return undefined;
}
