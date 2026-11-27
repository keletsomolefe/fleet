import { p } from '@mikro-orm/postgresql';

/** PostgreSQL-generated UUID primary key (`gen_random_uuid()`). */
export const uuidPrimaryKey = () =>
  p.uuid().primary().defaultRaw('gen_random_uuid()');

/** Automatic `timestamptz` creation timestamp (`now()`). */
export const createdAtColumn = () =>
  p
    .datetime()
    .columnType('timestamptz')
    .defaultRaw('now()')
    .onCreate(() => new Date());

/** Automatic `timestamptz` update timestamp (`now()`). */
export const updatedAtColumn = () =>
  p
    .datetime()
    .columnType('timestamptz')
    .defaultRaw('now()')
    .onCreate(() => new Date())
    .onUpdate(() => new Date());

/** Composable `createdAt` + `updatedAt` columns for `defineEntity()`. */
export const timestampColumns = () => ({
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});
