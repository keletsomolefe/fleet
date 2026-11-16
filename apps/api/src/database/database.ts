import {
  raw,
  type EntityManager as MikroEntityManager,
  type EntityName,
  type FilterQuery,
  type Loaded,
  type MikroORM,
  LockMode,
  RequestContext,
} from '@mikro-orm/postgresql';

/**
 * Persistence layer used by the API services.
 *
 * MikroORM is the only ORM: entities, schema migrations and seeders are native
 * MikroORM. This module keeps the small set of query/persist helpers the
 * services share in one place, so request-scoped EntityManagers are always
 * used (the global EntityManager is disabled via `allowGlobalContext: false`)
 * and transaction scoping stays explicit.
 */

export type Scope = MikroEntityManager;

/**
 * Raw SQL in the services keeps Postgres `$1` placeholders (and older `?`
 * queries). MikroORM em.execute() expects `?` placeholders, so translate every
 * placeholder to `?` and rebuild the parameter list in textual order. Repeated
 * placeholders are duplicated, and `::` casts are left untouched.
 */
function toPgArray(values: unknown[]): string {
  return (
    '{' +
    values
      .map((value) => {
        if (value === null || value === undefined) return 'NULL';
        return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      })
      .join(',') +
    '}'
  );
}

function translateQuery(sql: string, params: unknown[] = []): [string, unknown[]] {
  if (!params.length || !/[\$]\d+/.test(sql)) return [sql, params];
  const ordered: unknown[] = [];
  let sequential = 0;
  const translated = sql.replace(/[\$](\d+)|[?]/g, (_match: string, index?: string) => {
    const value = index ? params[Number(index) - 1] : params[sequential++];
    ordered.push(Array.isArray(value) ? toPgArray(value) : value);
    return "?";
  });
  return [translated, ordered];
}

function isMikroOrmInstance(value: unknown): value is MikroORM {
  return !!value && typeof (value as MikroORM).close === 'function' && !!(value as MikroORM).em;
}

/** Persistent, managed entity manager for one unit of work. */
export class EntityManager {
  constructor(readonly em: MikroEntityManager) {}

  getRepository<Entity extends object>(entity: EntityName<Entity>): Repository<Entity> {
    return new Repository(this, entity);
  }

  repo<Entity extends object>(entity: EntityName<Entity>): Repository<Entity> {
    return new Repository(this, entity);
  }

  private metadata(entity: EntityName<object>) {
    try {
      return this.em.getMetadata().get(entity as never);
    } catch {
      return undefined;
    }
  }

  private relationColumnMap(entity: EntityName<object>): Map<string, string> {
    const meta = this.metadata(entity);
    const map = new Map<string, string>();
    if (!meta) return map;
    for (const property of Object.values(meta.properties)) {
      if (property.fieldNames?.length === 1 && ['m:1', '1:1', 'm:n'].includes(property.kind as string)) {
        map.set(property.fieldNames[0], property.name);
      }
    }
    return map;
  }

  /** Maps TypeORM-style FK column keys to MikroORM relation property names. */
  translateData(entity: EntityName<object>, data: Record<string, unknown>): Record<string, unknown> {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data))
      return data.map((entry) =>
        this.translateData(entity, entry as Record<string, unknown>),
      ) as unknown as Record<string, unknown>;
    const columns = this.relationColumnMap(entity);
    if (![...columns.keys()].some((column) => column in data)) return data;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data))
      result[columns.get(key) ?? key] = value;
    return result;
  }

  /** Maps TypeORM-style FK column keys in a where object to relation property names. */
  translateWhere(entity: EntityName<object>, where: Record<string, unknown>): Record<string, unknown> {
    if (!where || typeof where !== 'object') return where;
    if (Array.isArray(where))
      return where.map((entry) =>
        this.translateWhere(entity, entry as Record<string, unknown>),
      ) as unknown as Record<string, unknown>;
    const columns = this.relationColumnMap(entity);
    if (![...columns.keys()].some((column) => column in where)) return where;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(where)) result[columns.get(key) ?? key] = value;
    return result;
  }

  create<Entity extends object>(entity: EntityName<Entity>, data: any): Entity {
    return this.em.create(entity, this.translateData(entity as never, data) as never) as Entity;
  }

  async findOne<Entity extends object>(
    entity: EntityName<Entity>,
    whereOrOptions: any,
    options: FindOneOptions<Entity> = {},
  ): Promise<Entity | null> {
    const parsed = splitWhereOptions(whereOrOptions, options);
    return (await this.em.findOne(entity, this.translateWhere(entity as never, parsed.where as never) as never, toMikroOptions(parsed.options))) as Entity | null;
  }

  async findOneOrFail<Entity extends object>(
    entity: EntityName<Entity>,
    whereOrOptions: any,
    options: FindOneOptions<Entity> = {},
  ): Promise<Entity> {
    const parsed = splitWhereOptions(whereOrOptions, options);
    return (await this.em.findOneOrFail(entity, this.translateWhere(entity as never, parsed.where as never) as never, toMikroOptions(parsed.options))) as Entity;
  }

  async find<Entity extends object>(
    entity: EntityName<Entity>,
    where: any = {},
    options: FindOptions<Entity> = {},
  ): Promise<Entity[]> {
    const parsed = splitWhereOptions(where, options);
    return (await this.em.find(entity, this.translateWhere(entity as never, parsed.where as never) as never, toMikroOptions(parsed.options))) as Entity[];
  }

  async findBy<Entity extends object>(entity: EntityName<Entity>, where: any): Promise<Entity[]> {
    return (await this.em.find(entity, this.translateWhere(entity as never, where as never) as never)) as Entity[];
  }

  async findOneBy<Entity extends object>(entity: EntityName<Entity>, where: any): Promise<Entity | null> {
    return (await this.em.findOne(entity, this.translateWhere(entity as never, where as never) as never)) as Entity | null;
  }

  async findOneByOrFail<Entity extends object>(entity: EntityName<Entity>, where: any): Promise<Entity> {
    return (await this.em.findOneOrFail(entity, this.translateWhere(entity as never, where as never) as never)) as Entity;
  }

  async count<Entity extends object>(entity: EntityName<Entity>, where: any = {}): Promise<number> {
    return this.em.count(entity, this.translateWhere(entity as never, where as never) as never);
  }

  async existsBy<Entity extends object>(entity: EntityName<Entity>, where: any): Promise<boolean> {
    return (await this.em.count(entity, this.translateWhere(entity as never, where as never) as never)) > 0;
  }

  async save<Entity extends object>(entity: Entity): Promise<Entity>;
  async save<Entity extends object>(entity: EntityName<Entity>, data: any): Promise<Entity>;
  async save<Entity extends object>(a: any, b?: any): Promise<Entity> {
    // `save(Entity, entity)` is common in converted TypeORM code. Do not recreate
    // an entity that is already an instance; `em.create()` on an instance can
    // leave the original managed and produce a duplicate insert on flush.
    let entity: Entity;
    if (b === undefined) {
      entity = a as Entity;
    } else {
      let entityClass: unknown;
      try {
        entityClass = this.em.getMetadata().get(a as never).class;
      } catch {
        entityClass = undefined;
      }
      entity =
        typeof entityClass === 'function' && b instanceof (entityClass as Function)
          ? (b as Entity)
          : (this.create(a as EntityName<Entity>, b) as Entity);
    }
    this.em.persist(entity as object);
    await this.em.flush();
    return entity;
  }

  async update<Entity extends object>(
    entity: EntityName<Entity>,
    where: any,
    data: any,
  ): Promise<number> {
    return this.em.nativeUpdate(entity, this.translateWhere(entity as never, where as never) as never, this.translateData(entity as never, data) as never);
  }

  async delete<Entity extends object>(entity: EntityName<Entity>, where: any): Promise<number> {
    return this.em.nativeDelete(entity, this.translateWhere(entity as never, where as never) as never);
  }

  async insert<Entity extends object>(entity: EntityName<Entity>, data: Record<string, unknown> | Record<string, unknown>[]): Promise<unknown> {
    return this.em.insert(entity, this.translateData(entity as never, data as Record<string, unknown>) as never);
  }

  async upsert<Entity extends object>(
    entity: EntityName<Entity>,
    data: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflictFields?: readonly string[]; onConflictAction?: 'ignore' | 'merge' } = {},
  ): Promise<unknown> {
    const conflict = options.onConflictFields ? [...options.onConflictFields] : undefined;
    if (Array.isArray(data)) {
      return this.em.upsertMany(entity, data as never[], { onConflictFields: conflict as never, onConflictAction: options.onConflictAction });
    }
    return this.em.upsert(entity, data as never, { onConflictFields: conflict as never, onConflictAction: options.onConflictAction });
  }

  async query<Row = any>(sql: string, params: unknown[] = []): Promise<Row[]> {
    const [text, values] = translateQuery(sql, params);
    return (await this.em.execute(text, values as never[])) as Row[];
  }

  async execute<Row = any>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.query(sql, params);
  }

  nativeUpdate(entity: EntityName<object>, where: any, data: any) { return this.update(entity, where, data); }

  nativeDelete(entity: EntityName<object>, where: any) { return this.delete(entity, where); }

  async transactional<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.em.transactional((em) => work(new EntityManager(em)));
  }

  getMikroEntityManager(): MikroEntityManager {
    return this.em;
  }

  createQueryBuilder<Entity extends object>(entity: EntityName<Entity>, alias?: string): QueryBuilder<Entity>;
  createQueryBuilder(): UpdateQueryBuilder<any>;
  createQueryBuilder<Entity extends object>(entity?: EntityName<Entity>, alias?: string): QueryBuilder<Entity> | UpdateQueryBuilder<any> {
    if (!entity) return new UpdateQueryBuilder(this);
    return new QueryBuilder(this, entity, alias);
  }
}

/** Repository-style access bound to one EntityManager. */
export class Repository<Entity extends object> {
  constructor(
    readonly manager: EntityManager,
    readonly entityName: EntityName<Entity>,
  ) {}

  findOneBy(where: any): Promise<Entity | null> {
    return this.manager.findOne(this.entityName, where);
  }

  findOneByOrFail(where: any): Promise<Entity> {
    return this.manager.findOneOrFail(this.entityName, where);
  }

  findOne(options: any = {}): Promise<Entity | null> {
    const { where, ...rest } = options;
    return this.manager.findOne(this.entityName, (where ?? {}) as FilterQuery<Entity>, rest);
  }

  findOneOrFail(options: any = {}): Promise<Entity> {
    const { where, ...rest } = options;
    return this.manager.findOneOrFail(this.entityName, (where ?? {}) as FilterQuery<Entity>, rest);
  }

  find(options: any = {}): Promise<Entity[]> {
    const { where, ...rest } = options;
    return this.manager.find(this.entityName, (where ?? {}) as FilterQuery<Entity>, rest);
  }

  findBy(where: any): Promise<Entity[]> {
    return this.manager.findBy(this.entityName, where);
  }

  async findAndCount(options: FindOptions<Entity> & { where?: FilterQuery<Entity> } = {}): Promise<[Entity[], number]> {
    const { where, ...rest } = options;
    const items = await this.manager.find(this.entityName, (where ?? {}) as FilterQuery<Entity>, rest);
    const total = await this.manager.count(this.entityName, (where ?? {}) as FilterQuery<Entity>);
    return [items, total];
  }

  save(entity: Entity): Promise<Entity>;
  save(entities: Entity[]): Promise<Entity[]>;
  save(data: any): Promise<Entity>;
  async save(entity: any): Promise<any> {
    if (Array.isArray(entity)) {
      this.manager.em.persist(entity);
      await this.manager.em.flush();
      return entity;
    }
    if (entity.constructor === Object) {
      return this.manager.save(this.entityName, entity);
    }
    return this.manager.save(entity as Entity);
  }

  create(data: any): Entity {
    return this.manager.create(this.entityName, data);
  }

  update(where: any, data: any): Promise<number> {
    return this.manager.update(this.entityName, where, data);
  }

  delete(where: any): Promise<number> {
    return this.manager.delete(this.entityName, where);
  }

  count(options: any = {}): Promise<number> {
    return this.manager.count(this.entityName, (options.where ?? {}) as FilterQuery<Entity>);
  }

  existsBy(where: any): Promise<boolean> {
    return this.manager.existsBy(this.entityName, where);
  }

  countBy(where: any): Promise<number> {
    return this.manager.count(this.entityName, where);
  }

  insert(data: any): Promise<unknown> {
    return this.manager.insert(this.entityName, data);
  }

  getEntityName(): EntityName<Entity> {
    return this.entityName;
  }

  createQueryBuilder(alias?: string): QueryBuilder<Entity> {
    return new QueryBuilder(this.manager, this.entityName, alias);
  }
}

export interface FindOptions<Entity extends object> {
  relations?: Record<string, unknown> | string[];
  order?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  take?: number;
  skip?: number;
  limit?: number;
  offset?: number;
  lock?: { mode: string } | boolean;
  lockMode?: number;
  refresh?: boolean;
  populate?: string[];
  fields?: string[];
}

type FindOneOptions<Entity extends object> = FindOptions<Entity>;

function splitWhereOptions<Entity extends object>(
  whereOrOptions: FilterQuery<Entity> | FindOptions<Entity>,
  options: FindOptions<Entity>,
): { where: FilterQuery<Entity> | FindOptions<Entity>; options: FindOptions<Entity> } {
  if (isOptionsObject(whereOrOptions)) {
    const { where, ...rest } = whereOrOptions as FindOptions<Entity> & { where?: FilterQuery<Entity> };
    return { where: (where ?? {}) as FilterQuery<Entity>, options: { ...rest, ...options } };
  }
  return { where: whereOrOptions, options };
}

function isOptionsObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return (
    keys.length > 0 &&
    keys.every((key) =>
      ['where', 'relations', 'order', 'orderBy', 'take', 'skip', 'limit', 'offset', 'lock', 'lockMode', 'refresh', 'populate', 'fields'].includes(key),
    )
  );
}

export function toMikroOptions(options: FindOptions<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (options.populate) result.populate = options.populate;
  else if (options.relations) result.populate = flattenRelations(options.relations);
  const order = options.orderBy ?? options.order;
  if (order) result.orderBy = normalizeOrder(order);
  if (options.take !== undefined) result.limit = options.take;
  else if (options.limit !== undefined) result.limit = options.limit;
  if (options.skip !== undefined) result.offset = options.skip;
  else if (options.offset !== undefined) result.offset = options.offset;
  if (options.lockMode !== undefined) result.lockMode = options.lockMode;
  else if (options.lock && typeof options.lock === 'object' && options.lock.mode === 'pessimistic_write')
    result.lockMode = LockMode.PESSIMISTIC_WRITE;
  else if (options.lock && typeof options.lock === 'object' && options.lock.mode === 'pessimistic_read')
    result.lockMode = LockMode.PESSIMISTIC_READ;
  if (options.refresh) result.refresh = true;
  if (options.fields) result.fields = options.fields;
  return result;
}

function normalizeOrder(order: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(order)) {
    result[key] = typeof value === 'string' ? value.toLowerCase() : value;
  }
  return result;
}

/** Flattens TypeORM `{ relation: true | { nested: true } }` into populate paths. */
export function flattenRelations(relations: Record<string, unknown> | string[]): string[] {
  if (Array.isArray(relations)) return relations;
  const paths: string[] = [];
  const walk = (value: Record<string, unknown>, prefix: string) => {
    for (const [key, nested] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (nested === true) paths.push(path);
      else if (nested && typeof nested === 'object') walk(nested as Record<string, unknown>, path);
    }
  };
  walk(relations, '');
  return paths;
}

/**
 * Application database: one MikroORM instance plus helpers that always use a
 * request-scoped EntityManager. Background jobs and scripts fork explicitly.
 */
export class Database {
  constructor(readonly orm: MikroORM) {}

  get em(): EntityManager {
    const contextEm = RequestContext.getEntityManager() as MikroEntityManager | undefined;
    return new EntityManager(contextEm ?? this.orm.em.fork());
  }

  get manager(): EntityManager {
    return this.em;
  }

  fork(): EntityManager {
    return new EntityManager(this.orm.em.fork());
  }

  getRepository<Entity extends object>(entity: EntityName<Entity>): Repository<Entity> {
    return new Repository(this.em, entity);
  }

  repo<Entity extends object>(entity: EntityName<Entity>): Repository<Entity> {
    return new Repository(this.em, entity);
  }

  get migrator() {
    return this.orm.migrator;
  }

  transaction<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.em.transactional(work);
  }

  async query<Row = any>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.em.query(sql, params);
  }

  async execute<Row = any>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.em.query(sql, params);
  }

  get isInitialized(): boolean {
    return true;
  }

  async initialize(): Promise<this> {
    await this.orm.connect();
    return this;
  }

  async destroy(): Promise<void> {
    await this.orm.close(true);
  }

  async close(): Promise<void> {
    await this.destroy();
  }

  findOne(entity: EntityName<object>, where: any, options: any = {}) { return this.em.findOne(entity as never, where, options); }
  findOneOrFail(entity: EntityName<object>, where: any, options: any = {}) { return this.em.findOneOrFail(entity as never, where, options); }
  find(entity: EntityName<object>, where: any = {}, options: any = {}) { return this.em.find(entity as never, where, options); }
  findOneBy(entity: EntityName<object>, where: any) { return this.em.findOneBy(entity as never, where); }
  findOneByOrFail(entity: EntityName<object>, where: any) { return this.em.findOneByOrFail(entity as never, where); }
  findBy(entity: EntityName<object>, where: any) { return this.em.findBy(entity as never, where); }
  count(entity: EntityName<object>, where: any = {}) { return this.em.count(entity as never, where); }
  countBy(entity: EntityName<object>, where: any = {}) { return this.em.count(entity as never, where); }
  existsBy(entity: EntityName<object>, where: any) { return this.em.existsBy(entity as never, where); }
  create(entity: EntityName<object>, data: any) { return this.em.create(entity as never, data); }
  save(entity: any, data?: any) { return data === undefined ? this.em.save(entity) : this.em.save(entity, data); }
  update(entity: EntityName<object>, where: any, data: any) { return this.em.update(entity as never, where, data); }
  delete(entity: EntityName<object>, where: any) { return this.em.delete(entity as never, where); }
  insert(entity: EntityName<object>, data: any) { return this.em.insert(entity as never, data); }
}

// ---------------------------------------------------------------------------
// Filter helpers (MikroORM operator objects) used by the converted services.
// ---------------------------------------------------------------------------
export function In<T>(values: readonly T[]): { $in: readonly T[] } {
  return { $in: values };
}

export function Not<T>(value: T): { $ne: T } {
  return { $ne: value };
}

export function IsNull(): null {
  return null;
}

export { isMikroOrmInstance };
export type LoadedEntity<T> = Loaded<T, never>;

// ---------------------------------------------------------------------------
// Minimal query-builder bridge. MikroORM's QueryBuilder is used underneath;
// TypeORM-style `:name` parameters and `:...spread` arrays are translated.
// ---------------------------------------------------------------------------
function translateCondition(
  condition: string,
  params?: Record<string, unknown> | readonly unknown[],
): [string, unknown[]] {
  if (!params) return [condition, []];
  const args: unknown[] = [];
  const sql = condition.replace(
    /(?<!:):(\.\.\.)?([A-Za-z_]\w*)/g,
    (_match, spread: string | undefined, name: string) => {
      const source = params as Record<string, unknown>;
      const value = source[name];
      if (spread) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) args.push(item);
        return values.map(() => '?').join(', ');
      }
      args.push(value);
      return '?';
    },
  );
  return [sql, args];
}

type MikroQueryBuilder = ReturnType<MikroEntityManager['createQueryBuilder']>;

function quoteOrderField(field: string): string {
  const trimmed = field.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot === -1) return trimmed.startsWith('"') ? trimmed : `"${trimmed}"`;
  const alias = trimmed.slice(0, dot);
  const column = trimmed.slice(dot + 1);
  return `${alias}.${column.startsWith('"') ? column : `"${column}"`}`;
}

export class QueryBuilder<Entity extends object> {
  protected qb: MikroQueryBuilder;
  private orders: Array<[string, string]> = [];

  constructor(
    protected readonly manager: EntityManager,
    entity: EntityName<Entity>,
    alias?: string,
  ) {
    this.qb = manager.em.createQueryBuilder(entity, alias) as unknown as MikroQueryBuilder;
  }

  where(condition: string, params?: Record<string, unknown> | readonly unknown[]): this {
    const [sql, args] = translateCondition(condition, params);
    this.qb.where(sql, args);
    return this;
  }

  andWhere(condition: string, params?: Record<string, unknown> | readonly unknown[]): this {
    const [sql, args] = translateCondition(condition, params);
    this.qb.andWhere(sql, args);
    return this;
  }

  orWhere(condition: string, params?: Record<string, unknown> | readonly unknown[]): this {
    const [sql, args] = translateCondition(condition, params);
    this.qb.orWhere(sql, args);
    return this;
  }

  leftJoinAndSelect(relation: string, alias: string): this {
    (this.qb as unknown as { leftJoinAndSelect: (r: string, a: string) => void }).leftJoinAndSelect(relation, alias);
    return this;
  }

  joinAndSelect(relation: string, alias: string): this {
    (this.qb as unknown as { joinAndSelect: (r: string, a: string) => void }).joinAndSelect(relation, alias);
    return this;
  }

  addSelect(field: string): this {
    try {
      (this.qb as unknown as { addSelect: (f: string) => void }).addSelect(field);
    } catch {
      // Hidden/sensitive columns are selected by default in this model.
    }
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' | 'asc' | 'desc' = 'asc'): this {
    this.orders = [[field, direction.toLowerCase()]];
    return this;
  }

  addOrderBy(field: string, direction: 'ASC' | 'DESC' | 'asc' | 'desc' = 'asc'): this {
    this.orders.push([field, direction.toLowerCase()]);
    return this;
  }

  private applyOrder(): void {
    if (!this.orders.length) return;
    const orderBy = this.orders.map(([field, direction]) => ({
      [raw(quoteOrderField(field))]: direction,
    }));
    (this.qb as unknown as { orderBy: (o: unknown) => void }).orderBy(orderBy);
  }

  skip(offset: number): this {
    (this.qb as unknown as { offset: (o: number) => void }).offset(offset);
    return this;
  }

  take(limit: number): this {
    (this.qb as unknown as { limit: (l: number) => void }).limit(limit);
    return this;
  }

  limit(limit: number): this {
    return this.take(limit);
  }

  offset(offset: number): this {
    return this.skip(offset);
  }

  async getMany(): Promise<Entity[]> {
    this.applyOrder();
    return (await this.qb.getResultList()) as Entity[];
  }

  async getOne(): Promise<Entity | null> {
    this.applyOrder();
    return (await this.qb.getSingleResult()) as Entity | null;
  }

  async getManyAndCount(): Promise<[Entity[], number]> {
    this.applyOrder();
    const items = (await this.qb.getResultList()) as Entity[];
    const total = await (this.qb as unknown as { getCount: () => Promise<number> }).getCount();
    return [items, total];
  }

  async getCount(): Promise<number> {
    return (this.qb as unknown as { getCount: () => Promise<number> }).getCount();
  }

  update(entity: EntityName<Entity>): UpdateQueryBuilder<Entity> {
    return new UpdateQueryBuilder<Entity>(this.manager).update(entity);
  }
}

/** TypeORM-style update builder used by a few services. */
export class UpdateQueryBuilder<Entity extends object> {
  private entity?: EntityName<Entity>;
  private data: Record<string, unknown> = {};
  private conditions: Array<[string, Record<string, unknown> | readonly unknown[] | undefined]> = [];

  constructor(private readonly manager: EntityManager) {}

  update(entity: EntityName<Entity>): this {
    this.entity = entity;
    return this;
  }

  set(data: Record<string, unknown>): this {
    this.data = { ...this.data, ...data };
    return this;
  }

  where(condition: string, params?: Record<string, unknown> | readonly unknown[]): this {
    this.conditions.push([condition, params]);
    return this;
  }

  andWhere(condition: string, params?: Record<string, unknown> | readonly unknown[]): this {
    this.conditions.push([condition, params]);
    return this;
  }

  async execute(): Promise<number> {
    if (!this.entity) throw new Error('UpdateQueryBuilder requires an entity.');
    const qb = this.manager.em.createQueryBuilder(this.entity) as unknown as {
      update: (data: Record<string, unknown>) => {
        where: (sql: string, args: unknown[]) => any;
      };
    };
    const updateQb = qb.update(this.data);
    let builder: any = null;
    for (const [condition, params] of this.conditions) {
      const [sql, args] = translateCondition(condition, params);
      if (!builder) builder = updateQb.where(sql, args);
      else builder = builder.andWhere(sql, args);
    }
    if (!builder) return 0;
    return builder.execute('run');
  }
}

export function createAdapterQueryBuilder<Entity extends object>(
  manager: EntityManager,
  entity: EntityName<Entity>,
  alias?: string,
): QueryBuilder<Entity> {
  return new QueryBuilder(manager, entity, alias);
}

// ---------------------------------------------------------------------------
// Small helpers kept alongside the adapter for service code that persists or
// checks existence against a specific EntityManager (inside transactions).
// ---------------------------------------------------------------------------
export async function save<T extends object>(em: EntityManager, entity: T): Promise<T> {
  return em.save(entity);
}

export async function saveNew<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  data: Record<string, unknown>,
): Promise<T> {
  return em.save(entity, data);
}

export async function exists<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  where: FilterQuery<T>,
): Promise<boolean> {
  return em.existsBy(entity, where);
}

export function isTransactionManager(value: unknown): value is EntityManager {
  return value instanceof EntityManager;
}


/** Reads a foreign key id from either a relation entity or a raw PK value. */
export function entityId(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return (value as { id?: unknown }).id ?? null;
}
