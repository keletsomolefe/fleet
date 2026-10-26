import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import type { AdminContext } from '../auth/auth.service.js';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { DrivingSession } from '../mobile/driving.entity.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import {
  ActivityRevision,
  Customer,
  CustomerProduct,
  Dispatch,
  Location,
  Product,
  RecordingContext,
  TransportAudit,
  TransportCharge,
  TransportRate,
  TransportRecord,
} from './transport.entity.js';
import {
  activity,
  bool,
  choice,
  date,
  decimal,
  fail,
  id,
  localDate,
  object,
  optionalId,
  ref,
  text,
  unit,
  units,
  version,
  type ActivityData,
  type DispatchPlan,
} from './transport.input.js';
import { calculateCharge, fixedCharge, scaled } from './pricing.js';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const master = {
  customers: Customer,
  locations: Location,
  products: Product,
  'customer-products': CustomerProduct,
} as const;
type MasterKind = keyof typeof master;
export const transportPermissions = [
  'customers.write',
  'locations.write',
  'products.read',
  'products.write',
  'dispatch.write',
  'activities.write',
  'activities.review',
  'pricing.read',
  'pricing.write',
  'revenue.read',
];

@Injectable()
export class TransportService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(OperationsEventsService)
    private readonly events: OperationsEventsService,
  ) {}
  require(c: AdminContext, permission: string) {
    if (
      !c.permissions.includes('admin.access') ||
      !c.permissions.includes(permission)
    )
      throw new ForbiddenException('You do not have access to this action.');
  }
  private async lock(m: EntityManager) {
    await m.query("SELECT pg_advisory_xact_lock(hashtext('fleet-transport'))");
  }
  private driver(c: AdminContext) {
    if (!c.permissions.includes('driver.access'))
      throw new ForbiddenException('Driver access is required.');
    return this.db
      .getRepository(DriverProfile)
      .findOneByOrFail({ userId: c.user.id, status: 'active' });
  }
  async catalogue(c: AdminContext, mobile = false) {
    if (mobile) await this.driver(c);
    else this.require(c, 'customers.read');
    const [customers, locations, products, customerProducts] =
      await Promise.all([
        this.db.getRepository(Customer).find({ order: { name: 'ASC' } }),
        this.db.getRepository(Location).find({ order: { name: 'ASC' } }),
        this.db.getRepository(Product).find({ order: { name: 'ASC' } }),
        this.db.getRepository(CustomerProduct).find(),
      ]);
    return {
      customers: mobile ? customers.filter((x) => x.active) : customers,
      locations: mobile ? locations.filter((x) => x.active) : locations,
      products: mobile ? products.filter((x) => x.active) : products,
      customerProducts: mobile
        ? customerProducts.filter((x) => x.active)
        : customerProducts,
      units: Object.keys(units),
      ...(!mobile && c.permissions.includes('activities.review')
        ? {
            trucks: await this.db.query(
              `SELECT id,identifier||' · '||registration AS name,true AS active,1 AS version FROM app.trucks ORDER BY identifier`,
            ),
          }
        : {}),
      downloadedAt: new Date().toISOString(),
    };
  }
  async saveMaster(
    c: AdminContext,
    kind: string,
    raw: unknown,
    recordId?: string,
  ) {
    if (!Object.hasOwn(master, kind)) throw new NotFoundException();
    const k = kind as MasterKind;
    this.require(c, `${k === 'customer-products' ? 'customers' : k}.write`);
    const keys = {
      customers: [
        'name',
        'contact',
        'email',
        'phone',
        'notes',
        'active',
        'version',
      ],
      locations: [
        'name',
        'directions',
        'contact',
        'phone',
        'customerIds',
        'latitude',
        'longitude',
        'active',
        'version',
      ],
      products: ['name', 'unit', 'active', 'version'],
      'customer-products': [
        'customerId',
        'productId',
        'supplies',
        'receives',
        'active',
        'version',
      ],
    };
    const v = object(raw, keys[k]);
    const values: Record<string, unknown> = { active: bool(v.active) };
    if (k !== 'customer-products') values.name = text(v.name, 200, true);
    if (k === 'customers')
      Object.assign(values, {
        contact: text(v.contact),
        email: text(v.email),
        phone: text(v.phone, 40),
        notes: text(v.notes, 2000),
      });
    if (k === 'products') values.unit = unit(v.unit);
    if (k === 'locations') {
      if (!Array.isArray(v.customerIds) || v.customerIds.length > 100) fail();
      const point = activity({
        kind: 'collection',
        occurredAt: new Date().toISOString(),
        latitude: v.latitude,
        longitude: v.longitude,
      });
      Object.assign(values, {
        directions: text(v.directions, 2000),
        contact: text(v.contact),
        phone: text(v.phone, 40),
        customerIds: [...new Set(v.customerIds.map(id))],
        latitude: point.latitude,
        longitude: point.longitude,
      });
    }
    if (k === 'customer-products')
      Object.assign(values, {
        customerId: id(v.customerId),
        productId: id(v.productId),
        supplies: bool(v.supplies, false),
        receives: bool(v.receives, false),
      });
    return this.db.transaction(async (m) => {
      await this.lock(m);
      if (
        values.customerId &&
        !(await m.existsBy(Customer, { id: values.customerId as string }))
      )
        fail('Choose a customer.');
      if (
        values.productId &&
        !(await m.existsBy(Product, { id: values.productId as string }))
      )
        fail('Choose a product.');
      for (const customerId of (values.customerIds ?? []) as string[])
        if (!(await m.existsBy(Customer, { id: customerId })))
          fail('Choose a customer.');
      const repo = m.getRepository(master[k]);
      const before = recordId
        ? await repo.findOneBy({ id: id(recordId) })
        : null;
      if (recordId && !before) throw new NotFoundException();
      if (before && before.version !== version(v.version))
        throw new ConflictException(
          'This record changed. Refresh and try again.',
        );
      const saved = await repo
        .save({
          ...before,
          ...values,
          version: (before?.version ?? 0) + 1,
        })
        .catch((error: unknown) => {
          if ((error as { code?: string })?.code === '23505')
            throw new ConflictException(
              'This record already exists. Open it to make changes.',
            );
          throw error;
        });
      await this.audit(
        m,
        saved.id,
        c.user.id,
        k,
        'Save details',
        before ?? {},
        saved,
      );
      return saved;
    });
  }
  async rates(c: AdminContext) {
    this.require(c, 'pricing.read');
    return this.db
      .getRepository(TransportRate)
      .find({ order: { startsOn: 'DESC' } });
  }
  async saveRate(c: AdminContext, raw: unknown) {
    this.require(c, 'pricing.write');
    const v = object(raw, [
      'customerProductId',
      'originId',
      'destinationId',
      'method',
      'basis',
      'unit',
      'price',
      'startsOn',
      'endsOn',
    ]);
    const data = {
      customerProductId: id(v.customerProductId),
      originId: optionalId(v.originId),
      destinationId: optionalId(v.destinationId),
      method: choice(v.method, ['quantity', 'delivery']),
      basis: choice(v.basis ?? 'delivered', ['collected', 'delivered']),
      unit: unit(v.unit),
      price: decimal(v.price, false)!,
      startsOn: date(v.startsOn),
      endsOn: v.endsOn ? date(v.endsOn) : null,
      createdById: c.user.id,
    };
    if ((data.originId == null) !== (data.destinationId == null))
      fail('Choose both route sites, or leave both empty.');
    if (data.endsOn && data.endsOn < data.startsOn)
      fail('The end date must follow the start date.');
    return this.db.transaction(async (m) => {
      await this.lock(m);
      const link = await m.findOneBy(CustomerProduct, {
        id: data.customerProductId,
        active: true,
      });
      if (!link) fail('Choose a customer product.');
      for (const site of [data.originId, data.destinationId])
        if (site && !(await m.existsBy(Location, { id: site, active: true })))
          fail('Choose an active site.');
      const overlap = await m.query(
        `SELECT id FROM app.transport_rates WHERE "customerProductId"=$1 AND "originId" IS NOT DISTINCT FROM $2::uuid AND "destinationId" IS NOT DISTINCT FROM $3::uuid AND "startsOn"<=COALESCE($5::date,'infinity'::date) AND COALESCE("endsOn",'infinity'::date)>=$4::date`,
        [
          data.customerProductId,
          data.originId,
          data.destinationId,
          data.startsOn,
          data.endsOn,
        ],
      );
      if (overlap.length)
        throw new ConflictException(
          'A rate already covers these dates. End that rate before adding another.',
        );
      const saved = await m.save(TransportRate, m.create(TransportRate, data));
      await this.audit(
        m,
        saved.id,
        c.user.id,
        'rate_created',
        'Agreed rate',
        {},
        saved,
      );
      return saved;
    });
  }
  async endRate(c: AdminContext, rateId: string, raw: unknown) {
    this.require(c, 'pricing.write');
    const v = object(raw, ['endsOn', 'expectedEndsOn', 'reason']);
    const endsOn = date(v.endsOn);
    return this.db.transaction(async (m) => {
      await this.lock(m);
      const rate = await m.findOneByOrFail(TransportRate, { id: id(rateId) });
      if (rate.endsOn !== (v.expectedEndsOn ?? null))
        throw new ConflictException(
          'This rate changed. Refresh and try again.',
        );
      if (endsOn < rate.startsOn)
        fail('The end date must follow the start date.');
      const overlap = await m.query(
        `SELECT id FROM app.transport_rates WHERE id<>$1 AND "customerProductId"=$2 AND "originId" IS NOT DISTINCT FROM $3::uuid AND "destinationId" IS NOT DISTINCT FROM $4::uuid AND "startsOn"<=$6::date AND COALESCE("endsOn",'infinity'::date)>=$5::date`,
        [
          rate.id,
          rate.customerProductId,
          rate.originId,
          rate.destinationId,
          rate.startsOn,
          endsOn,
        ],
      );
      if (overlap.length)
        throw new ConflictException('These dates overlap another agreed rate.');
      const before = { ...rate };
      rate.endsOn = endsOn;
      await m.save(rate);
      await this.audit(
        m,
        rate.id,
        c.user.id,
        'rate_ended',
        text(v.reason, 1000, true),
        before,
        rate,
      );
      return rate;
    });
  }
  async dispatches(c: AdminContext, mobile = false) {
    if (mobile) {
      const driver = await this.driver(c);
      const items = await this.db.getRepository(Dispatch).find({
        where: { driverId: driver.id, status: 'dispatched' },
        order: { date: 'DESC' },
        take: 200,
      });
      return this.dispatchConflicts(items);
    }
    this.require(c, 'dispatch.read');
    const [items, drivers, trucks] = await Promise.all([
      this.db
        .getRepository(Dispatch)
        .find({ order: { date: 'DESC' }, take: 200 }),
      this.db.query(
        `SELECT p.id, p.identifier, concat(u."firstName",' ',u."lastName") AS name FROM app.driver_profiles p JOIN app.users u ON u.id=p."userId" WHERE p.status='active' AND u."isActive"`,
      ),
      this.db
        .getRepository(Truck)
        .find({ where: { status: 'active' }, order: { identifier: 'ASC' } }),
    ]);
    return { items: await this.dispatchConflicts(items), drivers, trucks };
  }
  private async dispatchConflicts(items: Dispatch[]) {
    if (!items.length) return [];
    const rows: { id: string }[] = await this.db.query(
      `SELECT DISTINCT j.id FROM app.dispatches j JOIN app.driver_schedules s ON s.date=j.date AND s."cancelledAt" IS NULL AND ((s."driverId"=j."driverId" AND s."truckId"<>j."truckId") OR (s."truckId"=j."truckId" AND s."driverId"<>j."driverId")) WHERE j.id=ANY($1::uuid[])`,
      [items.map((j) => j.id)],
    );
    const conflicts = new Set(rows.map((x) => x.id));
    return items.map((job) =>
      Object.assign(job, { allocationConflict: conflicts.has(job.id) }),
    );
  }
  async saveDispatch(c: AdminContext, raw: unknown, dispatchId?: string) {
    this.require(c, 'dispatch.write');
    const v = object(raw, [
      'reference',
      'date',
      'driverId',
      'truckId',
      'plan',
      'status',
      'version',
    ]);
    const p = object(v.plan, [
      'customer',
      'product',
      'origin',
      'supplier',
      'quantity',
      'unit',
      'instructions',
      'collectionId',
      'deliveries',
    ]);
    if (
      !Array.isArray(p.deliveries) ||
      !p.deliveries.length ||
      p.deliveries.length > 50
    )
      fail('Add at least one delivery.');
    const plan: DispatchPlan = {
      customer: ref(p.customer),
      product: ref(p.product),
      origin: ref(p.origin),
      supplier: ref(p.supplier),
      quantity: decimal(p.quantity, false)!,
      unit: unit(p.unit),
      instructions: text(p.instructions, 2000),
      collectionId: p.collectionId ? id(p.collectionId) : randomUUID(),
      deliveries: p.deliveries.map((rawLine) => {
        const line = object(rawLine, [
          'id',
          'destination',
          'receiver',
          'quantity',
          'collectedQuantity',
        ]);
        return {
          id: line.id ? id(line.id) : randomUUID(),
          destination: ref(line.destination),
          receiver: ref(line.receiver),
          quantity: decimal(line.quantity, false)!,
          collectedQuantity: decimal(line.collectedQuantity),
        };
      }),
    };
    if (
      new Set([plan.collectionId, ...plan.deliveries.map((x) => x.id)]).size !==
      plan.deliveries.length + 1
    )
      fail('Each stop needs its own record.');
    const data = {
      reference: text(v.reference, 80, true),
      date: date(v.date),
      driverId: id(v.driverId),
      truckId: id(v.truckId),
      plan,
      status: choice(v.status ?? 'draft', ['draft', 'dispatched', 'cancelled']),
    };
    return this.db.transaction(async (m) => {
      await this.lock(m);
      // Share the allocation lock used by schedules and confirmed driving.
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const before = dispatchId
        ? await m.findOneByOrFail(Dispatch, { id: id(dispatchId) })
        : null;
      if (before && before.version !== version(v.version))
        throw new ConflictException('This job changed. Refresh and try again.');
      if (
        before &&
        (await m.existsBy(TransportRecord, { dispatchId: before.id }))
      )
        throw new ConflictException(
          'This job has activity. Keep its plan and record changes in the activity log.',
        );
      if (
        !(await m.existsBy(DriverProfile, {
          id: data.driverId,
          status: 'active',
        })) ||
        !(await m.existsBy(Truck, { id: data.truckId, status: 'active' }))
      )
        fail('Choose an active driver and vehicle.');
      await this.checkRefs(
        m,
        activity({
          customer: plan.customer,
          product: plan.product,
          origin: plan.origin,
          supplier: plan.supplier,
          quantity: plan.quantity,
          unit: plan.unit,
          kind: 'collection',
          occurredAt: new Date().toISOString(),
        }),
      );
      for (const line of plan.deliveries)
        if (
          line.destination.id &&
          !(await m.existsBy(Location, { id: line.destination.id }))
        )
          fail('Choose a destination.');
      const saved = await m.save(
        Dispatch,
        m.create(Dispatch, {
          ...before,
          ...data,
          version: (before?.version ?? 0) + 1,
          createdById: before?.createdById ?? c.user.id,
        }),
      );
      await this.audit(
        m,
        saved.id,
        c.user.id,
        'dispatch_saved',
        'Save job',
        before ?? {},
        saved,
      );
      return saved;
    });
  }
  async recordingContext(c: AdminContext, raw: unknown) {
    const driver = await this.driver(c);
    const v = object(raw, ['id', 'token']);
    const contextId = id(v.id),
      token = text(v.token, 64, true);
    if (!/^[a-f0-9]{64}$/.test(token)) fail();
    return this.db.transaction(async (m) => {
      await this.lock(m);
      const drive = await m.findOneBy(DrivingSession, {
        driverId: driver.id,
        endedAt: IsNull(),
      });
      if (
        !drive ||
        drive.confirmedDate !== localDate(new Date()) ||
        drive.kratosSessionId !== c.session.id
      )
        throw new ConflictException('Confirm your vehicle online first.');
      const existing = await m.findOne(RecordingContext, {
        where: { id: contextId },
        select: {
          id: true,
          driverId: true,
          truckId: true,
          drivingSessionId: true,
          tokenHash: true,
          createdAt: true,
        },
      });
      if (
        existing &&
        (existing.driverId !== driver.id ||
          existing.drivingSessionId !== drive.id ||
          existing.tokenHash !== hash(token))
      )
        throw new ConflictException(
          'This recording belongs to another session.',
        );
      const context =
        existing ??
        (await m.save(
          RecordingContext,
          m.create(RecordingContext, {
            id: contextId,
            driverId: driver.id,
            truckId: drive.truckId,
            drivingSessionId: drive.id,
            tokenHash: hash(token),
          }),
        ));
      return {
        id: context.id,
        driverId: driver.id,
        truckId: drive.truckId,
        confirmedDate: drive.confirmedDate,
      };
    });
  }
  async authenticateContext(
    contextId: unknown,
    token: unknown,
  ): Promise<RecordingContext> {
    const value = text(token, 64, true);
    const context = await this.db.getRepository(RecordingContext).findOne({
      where: { id: id(contextId) },
      select: {
        id: true,
        driverId: true,
        truckId: true,
        drivingSessionId: true,
        tokenHash: true,
        createdAt: true,
      },
    });
    if (!context || context.tokenHash !== hash(value))
      throw new UnauthorizedException('Could not upload these records.');
    return context;
  }
  async upload(raw: unknown, token: unknown) {
    const v = object(raw, ['contextId', 'events']);
    const context = await this.authenticateContext(v.contextId, token);
    if (
      !Array.isArray(v.events) ||
      v.events.length > 50 ||
      JSON.stringify(raw).length > 90000
    )
      fail('Send a smaller batch.');
    const accepted: {
        id: string;
        recordId: string;
        version: number;
        conflict: boolean;
      }[] = [],
      rejected: { id: string; reason: string }[] = [];
    for (const rawEvent of v.events) {
      const e = object(rawEvent, ['id', 'recordId', 'baseVersion', 'data']);
      const eventId = id(e.id);
      try {
        const recordId = id(e.recordId),
          baseVersion = version(e.baseVersion),
          data = activity(e.data);
        const digest = hash(JSON.stringify({ recordId, baseVersion, data }));
        const originalData = structuredClone(data);
        const result = await this.db.transaction(async (m) => {
          await this.lock(m);
          await m.query('SET LOCAL synchronous_commit = on');
          const existing = await m.findOneBy(ActivityRevision, { id: eventId });
          if (existing) {
            if (existing.digest !== digest || existing.contextId !== context.id)
              throw new ConflictException('This upload ID was already used.');
            const current = await m.findOneByOrFail(TransportRecord, {
              id: existing.recordId,
            });
            return { version: current.version, conflict: existing.conflict };
          }
          let current = await m.findOneBy(TransportRecord, { id: recordId });
          if (current) {
            const originalContext = await m.findOneByOrFail(RecordingContext, {
              id: current.contextId,
            });
            if (
              current.driverId !== context.driverId ||
              originalContext.truckId !== context.truckId
            )
              throw new ConflictException(
                'This activity belongs to another driver or vehicle.',
              );
          }
          await this.checkRefs(m, data);
          if (data.dispatchId) {
            const job = await m.findOneBy(Dispatch, { id: data.dispatchId });
            if (!job)
              fail('This job could not be found. Keep this as a manual entry.');
          }
          const conflict = (current?.version ?? 0) !== baseVersion;
          if (!current && conflict)
            throw new ConflictException('Upload the earlier revision first.');
          await m.insert(ActivityRevision, {
            id: eventId,
            recordId,
            contextId: context.id,
            digest,
            baseVersion,
            submission: { data: originalData },
            conflict,
          });
          if (conflict) {
            current!.flags = [
              ...new Set([...current!.flags, 'conflicting_revision']),
            ];
            current!.review = 'pending';
            current!.version++;
            await m.save(current!);
            return { version: current!.version, conflict: true };
          }
          if (current && current.kind !== data.kind)
            fail('An activity type cannot change.');
          current = m.create(TransportRecord, {
            ...current,
            id: recordId,
            driverId: context.driverId,
            truckId: current?.truckId ?? context.truckId,
            contextId: context.id,
            dispatchId: data.dispatchId,
            currentActivityId: eventId,
            kind: data.kind,
            occurredAt: new Date(data.occurredAt),
            data,
            version: (current?.version ?? 0) + 1,
            review: 'pending',
            reviewedById: null,
            reviewedAt: null,
          });
          current.flags = await this.flags(m, current, context);
          await m.save(current);
          await this.price(m, current);
          await this.refreshRun(m, current);
          return { version: current.version, conflict: false };
        });
        accepted.push({ id: eventId, recordId, ...result });
      } catch (error) {
        rejected.push({
          id: eventId,
          reason:
            error instanceof Error
              ? error.message
              : 'Could not save this activity.',
        });
      }
    }
    if (accepted.length) this.events.changed();
    const drive = await this.db
      .getRepository(DrivingSession)
      .findOneBy({ id: context.drivingSessionId });
    const profile = await this.db
      .getRepository(DriverProfile)
      .findOne({ where: { id: context.driverId }, relations: { user: true } });
    const grants = profile
      ? await this.db.query(
          `SELECT 1 FROM app.user_roles ur JOIN app.role_permissions rp ON rp."roleId"=ur."roleId" JOIN app.permissions p ON p.id=rp."permissionId" WHERE ur."userId"=$1 AND p.key='driver.access' LIMIT 1`,
          [profile.userId],
        )
      : [];
    return {
      accepted,
      rejected,
      stopCapture:
        !profile?.user.isActive ||
        profile.status !== 'active' ||
        !grants.length ||
        (!!drive?.endedAt && drive.endReason !== 'day_ended'),
      receivedAt: new Date().toISOString(),
    };
  }
  private async checkRefs(m: EntityManager, data: ActivityData) {
    for (const [key, entity] of [
      ['customer', Customer],
      ['supplier', Customer],
      ['receiver', Customer],
      ['product', Product],
      ['origin', Location],
      ['destination', Location],
    ] as const) {
      const value = data[key];
      if (value.id) {
        const found = await m.getRepository(entity).findOneBy({ id: value.id });
        if (!found) fail(`Choose a valid ${key}.`);
        value.name = found.name;
      }
    }
  }
  private async flags(
    m: EntityManager,
    record: TransportRecord,
    context: RecordingContext,
  ) {
    const d = record.data,
      flags: string[] = [];
    const drive = await m.findOneByOrFail(DrivingSession, {
      id: context.drivingSessionId,
    });
    const at = new Date(d.occurredAt);
    if (
      localDate(at) !== drive.confirmedDate ||
      at < drive.startedAt ||
      (drive.endedAt && at > drive.endedAt)
    )
      flags.push('unconfirmed_allocation');
    if (d.kind === 'fuel') {
      if (d.fuelLitres == null) flags.push('missing_fuel_quantity');
      if (d.fuelTotalCost == null) flags.push('missing_fuel_cost');
    } else {
      for (const field of [
        'customer',
        'product',
        d.kind === 'collection' ? 'origin' : 'destination',
      ] as const)
        if (!d[field].id) flags.push(`unmatched_${field}`);
      if (d.quantity == null) flags.push('missing_quantity');
      if (
        d.customer.id &&
        d.product.id &&
        !(await m.existsBy(CustomerProduct, {
          customerId: d.customer.id,
          productId: d.product.id,
          active: true,
        }))
      )
        flags.push('missing_customer_product');
      if (
        d.kind === 'collection' &&
        d.allocations.length &&
        d.quantity != null &&
        d.allocations.reduce((n, x) => n + scaled(x.quantity), 0n) !==
          scaled(d.quantity)
      )
        flags.push('load_allocation_mismatch');
      if (d.quantity && units[d.unit][0] === 'mass') {
        const truck = await m.findOneByOrFail(Truck, { id: record.truckId });
        if (
          truck.payloadCapacityKg &&
          scaled(d.quantity) * BigInt(units[d.unit][1]) >
            BigInt(truck.payloadCapacityKg) * 1000000n
        )
          flags.push('above_recorded_capacity');
      }
      if (d.outcome === 'partial') flags.push('partial_delivery');
      if (d.dispatchId) {
        const job = await m.findOneByOrFail(Dispatch, { id: d.dispatchId });
        const line = job.plan.deliveries.find((x) => x.id === record.id);
        const expected =
          d.kind === 'collection' ? job.plan.quantity : line?.quantity;
        const changed =
          d.customer.id !== job.plan.customer.id ||
          d.product.id !== job.plan.product.id ||
          d.origin.id !== job.plan.origin.id ||
          (line && d.destination.id !== line.destination.id) ||
          (d.kind === 'delivery' && !line) ||
          (d.kind === 'collection' && record.id !== job.plan.collectionId) ||
          (expected != null &&
            (d.quantity == null || scaled(expected) !== scaled(d.quantity))) ||
          d.unit !== job.plan.unit ||
          job.truckId !== record.truckId ||
          job.driverId !== record.driverId ||
          job.status === 'cancelled';
        if (changed) {
          flags.push('dispatch_changed');
          if (!d.note) flags.push('missing_change_reason');
        }
      }
    }
    return [...new Set([...flags, ...(await this.runFlags(m, record))])];
  }
  private async runFlags(
    m: EntityManager,
    record: TransportRecord,
  ): Promise<string[]> {
    const runId = record.kind === 'collection' ? record.id : record.data.runId;
    if (!runId || record.kind === 'fuel') return [];
    const collection =
      record.kind === 'collection'
        ? record
        : await m.findOneBy(TransportRecord, { id: runId, kind: 'collection' });
    if (!collection)
      return record.data.collectedQuantity == null
        ? ['missing_collection']
        : [];
    if (
      collection.driverId !== record.driverId ||
      collection.truckId !== record.truckId ||
      collection.data.product.id !== record.data.product.id
    )
      return ['collection_allocation_conflict'];
    const children: TransportRecord[] = await m.query(
      `SELECT * FROM app.transport_records WHERE kind='delivery' AND data->>'runId'=$1 AND review<>'void'`,
      [runId],
    );
    const all = children.filter((x) => x.id !== record.id);
    if (record.kind === 'delivery' && record.review !== 'void')
      all.push(record);
    if (!all.length || collection.data.quantity == null) return [];
    const flags: string[] = [];
    const d = collection.data,
      target = units[d.unit];
    const shares = d.allocations.length
      ? d.allocations.map((x) => scaled(x.quantity) * BigInt(target[1]))
      : all.map((x) =>
          x.data.collectedQuantity != null &&
          units[x.data.unit][0] === target[0]
            ? scaled(x.data.collectedQuantity) * BigInt(units[x.data.unit][1])
            : null,
        );
    if (shares.some((x) => x == null)) flags.push('missing_load_shares');
    else if (
      shares.reduce<bigint>((sum, x) => sum + (x ?? 0n), 0n) !==
      scaled(d.quantity!) * BigInt(target[1])
    )
      flags.push('load_allocation_mismatch');
    const delivered = all.reduce(
      (sum, x) =>
        sum +
        (x.data.quantity != null && units[x.data.unit][0] === target[0]
          ? scaled(x.data.quantity) * BigInt(units[x.data.unit][1])
          : 0n),
      0n,
    );
    if (delivered > scaled(d.quantity!) * BigInt(target[1]))
      flags.push('delivered_exceeds_collection');
    return flags;
  }
  private async refreshRun(
    m: EntityManager,
    changed: TransportRecord,
    actorId?: string,
  ) {
    const runId =
      changed.kind === 'collection' ? changed.id : changed.data.runId;
    if (!runId || changed.kind === 'fuel') return;
    const related: { id: string }[] = await m.query(
      `SELECT id FROM app.transport_records WHERE id=$1::uuid OR data->>'runId'=$1::text`,
      [runId],
    );
    for (const row of related) {
      if (row.id === changed.id) continue;
      const record = await m.findOneByOrFail(TransportRecord, { id: row.id });
      const context = await m.findOneByOrFail(RecordingContext, {
        id: record.contextId,
      });
      const previous = await m.findOneBy(TransportCharge, {
        recordId: record.id,
      });
      const before = JSON.parse(
        JSON.stringify({ record, charge: previous }),
      ) as Record<string, unknown>;
      const flags = await this.flags(m, record, context);
      if (record.flags.includes('conflicting_revision'))
        flags.push('conflicting_revision');
      await this.price(m, record);
      const next = await m.findOneBy(TransportCharge, { recordId: record.id });
      if (
        JSON.stringify(flags) !== JSON.stringify(record.flags) ||
        previous?.amount !== next?.amount
      ) {
        record.flags = flags;
        record.version++;
        if (previous?.amount !== next?.amount) record.review = 'pending';
        await m.save(record);
        if (previous?.amount !== next?.amount) {
          const actor =
            actorId ??
            (await m.findOneByOrFail(DriverProfile, { id: changed.driverId }))
              .userId;
          await this.audit(
            m,
            record.id,
            actor,
            'collection_updated',
            'Linked collection changed',
            before,
            { record, charge: next },
          );
        }
      }
    }
  }
  private async price(
    m: EntityManager,
    record: TransportRecord,
    force = false,
  ) {
    if (record.kind !== 'delivery') return;
    const d = record.data;
    const charge = m.create(TransportCharge, {
      recordId: record.id,
      rateId: null,
      amount: null,
      snapshot: null,
      status: 'needs_pricing',
    });
    if (
      record.review === 'void' ||
      !d.transportCharge ||
      ['failed', 'cancelled'].includes(d.outcome)
    ) {
      charge.status = 'uncharged';
      await m.save(charge);
      return;
    }
    const link =
      d.customer.id && d.product.id
        ? await m.findOneBy(CustomerProduct, {
            customerId: d.customer.id,
            productId: d.product.id,
            active: true,
          })
        : null;
    if (!link) {
      await m.save(charge);
      return;
    }
    const scope = `${link.id}:${d.origin.id}:${d.destination.id}:${localDate(d.occurredAt)}`;
    const previous = await m.findOneBy(TransportCharge, {
      recordId: record.id,
    });
    let rate: TransportRate | null = null;
    if (!force && previous?.snapshot?.scope === scope)
      rate = previous.snapshot.rate as TransportRate;
    if (!rate) {
      const matches = await m.query(
        `SELECT * FROM app.transport_rates WHERE "customerProductId"=$1 AND "startsOn"<=$4::date AND ("endsOn" IS NULL OR "endsOn">=$4::date) AND (("originId"=$2::uuid AND "destinationId"=$3::uuid) OR ("originId" IS NULL AND "destinationId" IS NULL)) ORDER BY ("originId" IS NOT NULL) DESC LIMIT 1`,
        [link.id, d.origin.id, d.destination.id, localDate(d.occurredAt)],
      );
      rate = matches[0] ?? null;
    }
    if (rate) {
      let quantity =
        rate.basis === 'collected' ? d.collectedQuantity : d.quantity;
      let quantityUnit = d.unit;
      if (rate.basis === 'collected' && d.runId) {
        const collection = await m.findOneBy(TransportRecord, {
          id: d.runId,
          kind: 'collection',
        });
        const share = collection?.data.allocations.find(
          (x) => x.deliveryId === record.id,
        );
        if (
          share &&
          collection!.driverId === record.driverId &&
          collection!.truckId === record.truckId &&
          collection!.data.product.id === record.data.product.id
        ) {
          quantity = share.quantity;
          quantityUnit = collection!.data.unit;
        }
      }
      charge.amount =
        rate.method === 'delivery'
          ? fixedCharge(rate.price)
          : quantity == null
            ? null
            : calculateCharge(
                quantity,
                quantityUnit,
                rate.price,
                rate.unit as keyof typeof units,
              );
      if (charge.amount != null) {
        charge.status = 'priced';
        charge.rateId = rate.id;
        charge.snapshot = {
          rate,
          quantity,
          unit: quantityUnit,
          scope,
          currency: 'ZAR',
        };
      }
    }
    await m.save(charge);
  }
  async records(c: AdminContext) {
    this.require(c, 'activities.read');
    const financial = c.permissions.includes('revenue.read');
    return this.db.query(
      `SELECT r.*, t.registration, concat(u."firstName",' ',u."lastName") AS "driverName"${financial ? ', c.status AS "pricingStatus", c.amount' : ''} FROM app.transport_records r JOIN app.trucks t ON t.id=r."truckId" JOIN app.driver_profiles p ON p.id=r."driverId" JOIN app.users u ON u.id=p."userId" ${financial ? 'LEFT JOIN app.transport_charges c ON c."recordId"=r.id' : ''} ORDER BY r."occurredAt" DESC LIMIT 500`,
    );
  }
  async record(c: AdminContext, recordId: string) {
    this.require(c, 'activities.read');
    const record = await this.db
      .getRepository(TransportRecord)
      .findOneByOrFail({ id: id(recordId) });
    const revisions = await this.db
      .getRepository(ActivityRevision)
      .find({ where: { recordId: record.id }, order: { receivedAt: 'ASC' } });
    const audits = c.permissions.includes('revenue.read')
      ? await this.db
          .getRepository(TransportAudit)
          .find({ where: { recordId: record.id }, order: { createdAt: 'ASC' } })
      : [];
    const charge = c.permissions.includes('revenue.read')
      ? await this.db
          .getRepository(TransportCharge)
          .findOneBy({ recordId: record.id })
      : undefined;
    return { record, revisions, audits, charge };
  }
  async review(c: AdminContext, recordId: string, raw: unknown) {
    this.require(c, 'activities.review');
    const v = object(raw, [
      'version',
      'action',
      'reason',
      'data',
      'truckId',
      'reprice',
    ]);
    if (v.reprice) this.require(c, 'pricing.write');
    const action = choice(v.action, [
      'pending',
      'validated',
      'clarification',
      'void',
    ]);
    const reason = text(v.reason, 1000, true);
    const result = await this.db.transaction(async (m) => {
      await this.lock(m);
      const record = await m.findOneByOrFail(TransportRecord, {
        id: id(recordId),
      });
      if (record.version !== version(v.version))
        throw new ConflictException(
          'This activity changed. Refresh and try again.',
        );
      const before = {
        ...JSON.parse(JSON.stringify(record)),
        charge: await m.findOneBy(TransportCharge, { recordId: record.id }),
      } as Record<string, unknown>;
      if (v.data) {
        const next = activity(v.data);
        if (next.kind !== record.kind) fail('An activity type cannot change.');
        record.data = next;
        record.occurredAt = new Date(next.occurredAt);
        record.dispatchId = next.dispatchId;
      }
      if (v.truckId) {
        const truckId = id(v.truckId);
        if (!(await m.existsBy(Truck, { id: truckId })))
          fail('Choose a vehicle.');
        record.truckId = truckId;
      }
      await this.checkRefs(m, record.data);
      const context = await m.findOneByOrFail(RecordingContext, {
        id: record.contextId,
      });
      record.flags = await this.flags(m, record, context);
      if (action === 'validated')
        record.flags = record.flags.filter(
          (x) => x !== 'unconfirmed_allocation',
        );
      if (
        action === 'validated' &&
        record.flags.some(
          (x) =>
            x.startsWith('unmatched_') ||
            [
              'load_allocation_mismatch',
              'missing_load_shares',
              'collection_allocation_conflict',
              'delivered_exceeds_collection',
              'missing_customer_product',
              'missing_change_reason',
            ].includes(x),
        )
      )
        fail(
          'Match the customer, product and sites, and check the load shares before validating.',
        );
      record.review = action;
      record.reviewedById = c.user.id;
      record.reviewedAt = new Date();
      record.version++;
      await m.save(record);
      await this.price(m, record, !!v.reprice);
      await this.audit(
        m,
        record.id,
        c.user.id,
        v.reprice ? 'reprice' : action,
        reason,
        before,
        {
          ...record,
          charge: await m.findOneBy(TransportCharge, { recordId: record.id }),
        },
      );
      await this.refreshRun(m, record, c.user.id);
      return record;
    });
    this.events.changed();
    return result;
  }
  async reviewResults(c: AdminContext, rawIds: string) {
    const driver = await this.driver(c);
    const ids = rawIds.split(',').filter(Boolean).slice(0, 100).map(id);
    if (!ids.length) return [];
    return this.db.query(
      `SELECT id, version, review, flags, "reviewedAt" FROM app.transport_records WHERE "driverId"=$1 AND id=ANY($2::uuid[])`,
      [driver.id, ids],
    );
  }
  async earnings(c: AdminContext, rawMonth: string, rawTruck?: string) {
    this.require(c, 'revenue.read');
    const month = text(rawMonth, 7, true);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('Choose a month.');
    const truckId = optionalId(rawTruck);
    const params = [month + '-01', truckId];
    const rows = await this.db.query(
      `SELECT r.*, t.identifier AS "truckName", t.registration, c.amount, c.status AS "pricingStatus", cu.name AS "customerName", p.name AS "productName" FROM app.transport_records r JOIN app.trucks t ON t.id=r."truckId" LEFT JOIN app.transport_charges c ON c."recordId"=r.id LEFT JOIN app.customers cu ON cu.id=NULLIF(r.data->'customer'->>'id','')::uuid LEFT JOIN app.products p ON p.id=NULLIF(r.data->'product'->>'id','')::uuid WHERE (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date+interval '1 month' AND ($2::uuid IS NULL OR r."truckId"=$2) AND r.review<>'void' ORDER BY r."occurredAt",r.id`,
      params,
    );
    const totals = await this.db.query(
      `SELECT r."truckId", t.identifier AS "truckName",t.registration, count(*) FILTER(WHERE r.kind='delivery' AND r.data->>'outcome' IN ('completed','partial'))::int AS deliveries, COALESCE(sum(c.amount) FILTER(WHERE c.status='priced'),0)::text AS revenue, COALESCE(sum(c.amount) FILTER(WHERE c.status='priced' AND r.review='validated'),0)::text AS validated, COALESCE(sum(c.amount) FILTER(WHERE c.status='priced' AND r.review<>'validated'),0)::text AS "awaitingReview", count(*) FILTER(WHERE c.status='needs_pricing')::int AS unpriced, COALESCE(sum((r.data->>'fuelLitres')::numeric) FILTER(WHERE r.kind='fuel'),0)::text AS "fuelLitres", COALESCE(sum((r.data->>'fuelTotalCost')::numeric) FILTER(WHERE r.kind='fuel'),0)::text AS "fuelSpend", count(*) FILTER(WHERE r.kind='fuel' AND r.data->>'fuelTotalCost' IS NULL)::int AS "missingFuelPrices", max(r."updatedAt") AS "lastRecordAt" FROM app.transport_records r JOIN app.trucks t ON t.id=r."truckId" LEFT JOIN app.transport_charges c ON c."recordId"=r.id WHERE r.review<>'void' AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date+interval '1 month' AND ($2::uuid IS NULL OR r."truckId"=$2) GROUP BY r."truckId",t.identifier,t.registration ORDER BY t.identifier`,
      params,
    );
    const breakdown = (field: 'customer' | 'product') =>
      this.db.query(
        `SELECT r."truckId", COALESCE(NULLIF(r.data->'${field}'->>'name',''),'Not recorded') AS name, count(*)::int AS deliveries, COALESCE(sum(c.amount) FILTER(WHERE c.status='priced'),0)::text AS amount, count(*) FILTER(WHERE c.status='needs_pricing')::int AS unpriced FROM app.transport_records r LEFT JOIN app.transport_charges c ON c."recordId"=r.id WHERE r.kind='delivery' AND r.review<>'void' AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date+interval '1 month' AND ($2::uuid IS NULL OR r."truckId"=$2) GROUP BY r."truckId",r.data->'${field}'->>'id',r.data->'${field}'->>'name' ORDER BY name`,
        params,
      );
    const [byCustomer, byProduct] = await Promise.all([
      breakdown('customer'),
      breakdown('product'),
    ]);
    return {
      month,
      currency: 'ZAR',
      generatedAt: new Date().toISOString(),
      totals,
      byCustomer,
      byProduct,
      records: rows,
    };
  }
  private async audit(
    m: EntityManager,
    recordId: string,
    actorId: string,
    action: string,
    reason: string,
    before: object,
    after: object,
  ) {
    await m.save(
      TransportAudit,
      m.create(TransportAudit, {
        recordId,
        actorId,
        action,
        reason,
        before: JSON.parse(JSON.stringify(before)) as Record<string, unknown>,
        after: JSON.parse(JSON.stringify(after)) as Record<string, unknown>,
      }),
    );
  }
}
