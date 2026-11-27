import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  acquireAdvisoryLock,
  getEm,
  rawQuery,
} from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../shared/errors.js';
import { assertUuid, hashDeviceToken } from '../../../shared/identifiers.js';
import { photoType, type UploadedPhoto } from '../../../shared/storage/photo.js';
import {
  ensurePrivateDirectory,
  readPrivateFile,
  transportAttachmentDir,
  writePrivateFile,
} from '../../../shared/storage/private-storage.js';
import { strictObject, uuidField } from '../../../shared/validation.js';
import { DrivingSession } from '../../driving/domain/driving-session.entity.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import {
  ActivityRevision,
  RecordingContext,
  TransportAttachment,
  TransportAudit,
  TransportCharge,
  TransportRecord,
  type ActivityData,
  type AttachmentKind,
} from '../domain/activity.entity.js';
import {
  assertCanValidateRecord,
  evaluateActivityFlags,
} from '../domain/activity-rules.js';
import {
  Customer,
  CustomerProduct,
  Location,
  Product,
} from '../domain/catalogue.entity.js';
import { Dispatch } from '../domain/dispatch.entity.js';
import { TruckExpense } from '../domain/expense.entity.js';
import {
  calculateCharge,
  fixedCharge,
  type Unit,
} from '../domain/pricing.js';
import { TransportRate } from '../domain/rate.entity.js';
import {
  localOperationalDate,
  parseActivityData,
  parseAttachmentKind,
  parseReviewInput,
  parseVersion,
  toAttachmentDto,
  toRecordDto,
} from '../http/transport.dto.js';
import type { PricingService } from './pricing.service.js';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const mimeToExtension: Record<
  'image/jpeg' | 'image/png' | 'image/webp',
  string
> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class ActivityService {
  constructor(
    private readonly orm: MikroORM,
    private readonly pricing: PricingService,
    private readonly events: OperationsEventsService,
  ) {}

  private async activeDriverProfile(
    context: AdminContext,
    em: EntityManager = getEm(this.orm),
  ) {
    if (!context.permissions.includes('driver.access')) {
      throw new ForbiddenError('Driver access is not enabled.');
    }
    const profile = await em.findOne(
      DriverProfile,
      { user: context.user.id, status: 'active' },
      { populate: ['user'] },
    );
    if (!profile || !profile.user.isActive) {
      throw new ForbiddenError('Driver access is not active.');
    }
    return profile;
  }

  /** Creates or returns an append-only offline recording context bound to the active driving session. */
  async createRecordingContext(context: AdminContext, raw: unknown) {
    const v = strictObject(raw, ['id', 'token'], 'Check the recording request.');
    const id = assertUuid(v.id, 'Choose a valid recording session.');
    if (
      typeof v.token !== 'string' ||
      v.token.length < 32 ||
      v.token.length > 128
    ) {
      throw new BadRequestError('Invalid recording token.');
    }
    const tokenHash = hashDeviceToken(v.token);

    return getEm(this.orm).transactional(async (tx) => {
      const profile = await this.activeDriverProfile(context, tx);
      const session = await tx.findOne(
        DrivingSession,
        {
          driver: profile.id,
          kratosSessionId: context.session.id,
          endedAt: null,
        },
        { populate: ['truck'] },
      );
      if (!session) {
        throw new ConflictError('Confirm your vehicle online before recording.');
      }

      const existing = await tx.findOne(
        RecordingContext,
        { id },
        { populate: ['drivingSession'] },
      );
      if (existing) {
        if (
          existing.driver.id !== profile.id ||
          existing.truck.id !== session.truck.id ||
          existing.drivingSession.id !== session.id
        ) {
          throw new ConflictError('This recording session belongs to another vehicle.');
        }
        return {
          id: existing.id,
          driverId: existing.driver.id,
          truckId: existing.truck.id,
          drivingSessionId: existing.drivingSession.id,
          confirmedDate: existing.drivingSession.confirmedDate,
        };
      }

      const created = tx.create(RecordingContext, {
        id,
        driver: profile,
        truck: session.truck,
        drivingSession: session,
        tokenHash,
      });
      await tx.persist(created).flush();
      return {
        id: created.id,
        driverId: profile.id,
        truckId: session.truck.id,
        drivingSessionId: session.id,
        confirmedDate: session.confirmedDate,
      };
    });
  }

  async authenticateRecordingToken(
    contextId: unknown,
    tokenHeader: unknown,
    em: EntityManager = getEm(this.orm),
  ): Promise<RecordingContext> {
    if (typeof tokenHeader !== 'string' || tokenHeader.length < 32) {
      throw new UnauthorizedError('Recording token is required.');
    }
    const validId = assertUuid(contextId, 'Invalid recording session.');
    const tokenHash = hashDeviceToken(tokenHeader);
    const context = await em.findOne(
      RecordingContext,
      { id: validId, tokenHash },
      { populate: ['drivingSession', 'driver.user'] },
    );
    if (!context) {
      throw new UnauthorizedError('Invalid recording credentials.');
    }
    return context;
  }

  private async validateCatalogueRefs(
    tx: EntityManager,
    data: ActivityData,
  ): Promise<void> {
    const customerIds = [
      data.customer.id,
      data.supplier.id,
      data.receiver.id,
    ].filter((value): value is string => Boolean(value));
    const locationIds = [data.origin.id, data.destination.id].filter(
      (value): value is string => Boolean(value),
    );
    const [customers, locations, product] = await Promise.all([
      customerIds.length
        ? tx.find(Customer, { id: { $in: [...new Set(customerIds)] } })
        : Promise.resolve([]),
      locationIds.length
        ? tx.find(Location, { id: { $in: [...new Set(locationIds)] } })
        : Promise.resolve([]),
      data.product.id
        ? tx.findOne(Product, { id: data.product.id })
        : Promise.resolve(null),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const locationById = new Map(locations.map((l) => [l.id, l]));

    if (data.customer.id) {
      const c = customerById.get(data.customer.id);
      if (!c) throw new BadRequestError('Choose a valid customer.');
      data.customer.name = c.name;
    }
    if (data.supplier.id) {
      const s = customerById.get(data.supplier.id);
      if (!s) throw new BadRequestError('Choose a valid supplier.');
      data.supplier.name = s.name;
    }
    if (data.receiver.id) {
      const r = customerById.get(data.receiver.id);
      if (!r) throw new BadRequestError('Choose a valid receiver.');
      data.receiver.name = r.name;
    }
    if (data.origin.id) {
      const o = locationById.get(data.origin.id);
      if (!o) throw new BadRequestError('Choose a valid collection site.');
      data.origin.name = o.name;
    }
    if (data.destination.id) {
      const d = locationById.get(data.destination.id);
      if (!d) throw new BadRequestError('Choose a valid delivery site.');
      data.destination.name = d.name;
    }
    if (data.product.id) {
      if (!product) throw new BadRequestError('Choose a valid product.');
      data.product.name = product.name;
    }
  }

  private async computeRecordFlags(
    tx: EntityManager,
    record: TransportRecord,
    context: RecordingContext,
  ): Promise<string[]> {
    const session = await tx.findOneOrFail(DrivingSession, {
      id: context.drivingSession.id,
    });
    const hasCustomerProductLink =
      record.data.customer.id && record.data.product.id
        ? (await tx.count(CustomerProduct, {
            customer: record.data.customer.id,
            product: record.data.product.id,
            active: true,
          })) > 0
        : false;
    const dispatch = record.dispatch
      ? await tx.findOne(Dispatch, { id: record.dispatch.id })
      : null;
    const linkedCollection =
      record.kind === 'delivery' && record.data.runId
        ? await tx.findOne(TransportRecord, {
            id: record.data.runId,
            kind: 'collection',
          })
        : null;

    return evaluateActivityFlags({
      recordId: record.id,
      data: record.data,
      occurredAt: record.occurredAt,
      sessionStartedAt: session.startedAt,
      sessionEndedAt: session.endedAt,
      hasCustomerProductLink,
      dispatchPlan: dispatch?.plan ?? null,
      linkedCollection: linkedCollection
        ? {
            id: linkedCollection.id,
            driverId: linkedCollection.driver.id,
            truckId: linkedCollection.truck.id,
            data: linkedCollection.data,
          }
        : null,
      recordDriverId: record.driver.id,
      recordTruckId: record.truck.id,
    });
  }

  private async priceRecord(
    tx: EntityManager,
    record: TransportRecord,
    forceReprice = false,
  ): Promise<void> {
    if (record.kind !== 'delivery') return;
    const d = record.data;

    let charge = await tx.findOne(TransportCharge, { record: record.id });
    const previousSnapshot = charge?.snapshot ?? null;

    if (!charge) {
      charge = tx.create(TransportCharge, {
        record,
        rate: null,
        status: 'needs_pricing',
        amount: null,
        snapshot: null,
      });
      tx.persist(charge);
    }

    if (
      record.review === 'void' ||
      !d.transportCharge ||
      d.outcome === 'failed' ||
      d.outcome === 'cancelled'
    ) {
      charge.rate = null;
      charge.status = 'uncharged';
      charge.amount = null;
      charge.snapshot = null;
      await tx.flush();
      return;
    }

    const link =
      d.customer.id && d.product.id
        ? await tx.findOne(CustomerProduct, {
            customer: d.customer.id,
            product: d.product.id,
            active: true,
          })
        : null;
    if (!link) {
      charge.rate = null;
      charge.status = 'needs_pricing';
      charge.amount = null;
      charge.snapshot = null;
      await tx.flush();
      return;
    }

    const opDate = localOperationalDate(d.occurredAt);
    const scope = `${link.id}:${d.origin.id ?? ''}:${d.destination.id ?? ''}:${opDate}`;

    type RateSnapshot = {
      id: string;
      method: 'quantity' | 'delivery';
      basis: 'collected' | 'delivered';
      unit: Unit;
      price: string;
      startsOn: string;
      endsOn: string | null;
      originId: string | null;
      destinationId: string | null;
    };
    let rateSnapshot: RateSnapshot | null = null;

    if (
      !forceReprice &&
      previousSnapshot &&
      previousSnapshot.scope === scope &&
      previousSnapshot.rate &&
      typeof previousSnapshot.rate === 'object'
    ) {
      rateSnapshot = previousSnapshot.rate as RateSnapshot;
    }

    if (!rateSnapshot) {
      const rate = await this.pricing.resolveApplicableRate(
        tx,
        link.id,
        d.origin.id,
        d.destination.id,
        opDate,
      );
      if (rate) {
        rateSnapshot = {
          id: rate.id,
          method: rate.method,
          basis: rate.basis,
          unit: rate.unit,
          price: rate.price,
          startsOn: rate.startsOn,
          endsOn: rate.endsOn,
          originId: rate.origin?.id ?? null,
          destinationId: rate.destination?.id ?? null,
        };
      }
    }

    if (!rateSnapshot) {
      charge.rate = null;
      charge.status = 'needs_pricing';
      charge.amount = null;
      charge.snapshot = null;
      await tx.flush();
      return;
    }

    let quantity =
      rateSnapshot.basis === 'collected' ? d.collectedQuantity : d.quantity;
    let quantityUnit: Unit = d.unit;

    if (rateSnapshot.basis === 'collected' && d.runId) {
      const collection = await tx.findOne(TransportRecord, {
        id: d.runId,
        kind: 'collection',
      });
      const share = collection?.data.allocations.find(
        (x) => x.deliveryId === record.id,
      );
      if (
        share &&
        collection &&
        collection.driver.id === record.driver.id &&
        collection.truck.id === record.truck.id &&
        collection.data.product.id === record.data.product.id
      ) {
        quantity = share.quantity;
        quantityUnit = collection.data.unit;
      } else if (collection && !collection.data.allocations.length && !quantity) {
        quantity = collection.data.quantity;
        quantityUnit = collection.data.unit;
      }
    }

    const amount =
      rateSnapshot.method === 'delivery'
        ? fixedCharge(rateSnapshot.price)
        : quantity == null
          ? null
          : calculateCharge(
              quantity,
              quantityUnit,
              rateSnapshot.price,
              rateSnapshot.unit,
            );

    if (amount != null) {
      charge.status = 'priced';
      charge.rate = tx.getReference(TransportRate, rateSnapshot.id);
      charge.amount = amount;
      charge.snapshot = {
        rate: rateSnapshot,
        quantity,
        unit: quantityUnit,
        scope,
        currency: 'ZAR',
      };
    } else {
      charge.rate = null;
      charge.status = 'needs_pricing';
      charge.amount = null;
      charge.snapshot = null;
    }
    await tx.flush();
  }

  private async refreshLinkedRun(
    tx: EntityManager,
    changed: TransportRecord,
    actorUserId?: string,
  ): Promise<void> {
    if (changed.kind === 'fuel' || changed.kind === 'expense') return;
    const runId = changed.kind === 'collection' ? changed.id : changed.data.runId;
    if (!runId) return;

    const related = await rawQuery<{ id: string }>(
      tx,
      `SELECT id FROM app.transport_records WHERE id = $1::uuid OR data->>'runId' = $1::text`,
      [runId],
    );

    for (const row of related) {
      if (row.id === changed.id) continue;
      const record = await tx.findOne(TransportRecord, { id: row.id });
      if (!record) continue;
      const context = await tx.findOneOrFail(RecordingContext, {
        id: record.context.id,
      });
      const previous = await tx.findOne(TransportCharge, { record: record.id });
      const prevAmount = previous?.amount ?? null;
      const before = {
        version: record.version,
        review: record.review,
        flags: [...record.flags],
        chargeAmount: prevAmount,
      };

      const flags = await this.computeRecordFlags(tx, record, context);
      if (record.flags.includes('conflicting_revision')) {
        flags.push('conflicting_revision');
      }
      await this.priceRecord(tx, record);
      const next = await tx.findOne(TransportCharge, { record: record.id });
      const nextAmount = next?.amount ?? null;

      if (
        JSON.stringify(flags) !== JSON.stringify(record.flags) ||
        prevAmount !== nextAmount
      ) {
        record.flags = flags;
        record.version += 1;
        if (prevAmount !== nextAmount) {
          record.review = 'pending';
        }
        await tx.flush();

        if (prevAmount !== nextAmount) {
          let actor = actorUserId;
          if (!actor) {
            const driver = await tx.findOneOrFail(
              DriverProfile,
              { id: changed.driver.id },
              { populate: ['user'] },
            );
            actor = driver.user.id;
          }
          tx.persist(
            tx.create(TransportAudit, {
              recordId: record.id,
              entityType: 'transport_record',
              actor: tx.getReference(User, actor),
              action: 'collection_updated',
              reason: 'Linked collection changed',
              before,
              after: {
                version: record.version,
                review: record.review,
                flags: [...record.flags],
                chargeAmount: nextAmount,
              },
            }),
          );
          await tx.flush();
        }
      }
    }
  }

  /** Idempotent offline batch upload authenticated by append-only `X-Fleet-Recording-Token`. */
  async uploadBatch(raw: unknown, tokenHeader: unknown) {
    const v = strictObject(raw, ['contextId', 'events']);
    const em = getEm(this.orm);
    const context = await this.authenticateRecordingToken(
      v.contextId,
      tokenHeader,
      em,
    );
    if (
      !Array.isArray(v.events) ||
      v.events.length > 50 ||
      JSON.stringify(raw).length > 150_000
    ) {
      throw new BadRequestError('Send a smaller batch.');
    }

    const accepted: Array<{
      id: string;
      recordId: string;
      version: number;
      conflict: boolean;
    }> = [];
    const rejected: Array<{ id: string; reason: string }> = [];

    for (const rawEvent of v.events) {
      const e = strictObject(rawEvent, [
        'id',
        'recordId',
        'baseVersion',
        'data',
      ]);
      const eventId = assertUuid(e.id, 'Invalid event ID.');
      try {
        const recordId = assertUuid(e.recordId, 'Invalid record ID.');
        const baseVersion = parseVersion(e.baseVersion);
        const data = parseActivityData(e.data);
        const digest = sha256Hex(
          JSON.stringify({ recordId, baseVersion, data }),
        );
        const originalData = structuredClone(data);

        const result = await em.transactional(async (tx) => {
          await acquireAdvisoryLock(tx, 'fleet-transport-records-v1');
          await rawQuery(tx, 'SET LOCAL synchronous_commit = on');

          const existingRev = await tx.findOne(ActivityRevision, {
            id: eventId,
          });
          if (existingRev) {
            if (
              existingRev.digest !== digest ||
              existingRev.context.id !== context.id
            ) {
              throw new ConflictError('This upload ID was already used.');
            }
            const current = await tx.findOneOrFail(TransportRecord, {
              id: existingRev.record.id,
            });
            return { version: current.version, conflict: existingRev.conflict };
          }

          let current = await tx.findOne(TransportRecord, { id: recordId });
          if (current) {
            const originalContext = await tx.findOneOrFail(RecordingContext, {
              id: current.context.id,
            });
            if (
              current.driver.id !== context.driver.id ||
              originalContext.truck.id !== context.truck.id
            ) {
              throw new ConflictError(
                'This activity belongs to another driver or vehicle.',
              );
            }
            if (current.review === 'validated' || current.review === 'void') {
              throw new ConflictError(
                'This activity has been reviewed by the office and can no longer be edited.',
              );
            }
          }

          await this.validateCatalogueRefs(tx, data);
          if (data.dispatchId) {
            const job = await tx.findOne(Dispatch, { id: data.dispatchId });
            if (!job) {
              throw new BadRequestError(
                'This job could not be found. Keep this as a manual entry.',
              );
            }
          }

          const conflict = (current?.version ?? 0) !== baseVersion;
          if (!current && conflict) {
            throw new ConflictError('Upload the earlier revision first.');
          }

          if (conflict && current) {
            tx.persist(
              tx.create(ActivityRevision, {
                id: eventId,
                record: current,
                context: tx.getReference(RecordingContext, context.id),
                digest,
                baseVersion,
                submission: { data: originalData },
                conflict: true,
              }),
            );
            current.flags = [
              ...new Set([...current.flags, 'conflicting_revision']),
            ];
            current.review = 'pending';
            current.version += 1;
            await tx.flush();
            return { version: current.version, conflict: true };
          }

          if (current && current.kind !== data.kind) {
            throw new BadRequestError('An activity type cannot change.');
          }

          if (!current) {
            current = tx.create(TransportRecord, {
              id: recordId,
              driver: tx.getReference(DriverProfile, context.driver.id),
              truck: tx.getReference(Truck, context.truck.id),
              context: tx.getReference(RecordingContext, context.id),
              dispatch: data.dispatchId
                ? tx.getReference(Dispatch, data.dispatchId)
                : null,
              currentActivityId: eventId,
              kind: data.kind,
              occurredAt: new Date(data.occurredAt),
              data,
              version: 1,
              review: 'pending',
              flags: [],
              reviewedBy: null,
              reviewedAt: null,
            });
            tx.persist(current);
          } else {
            current.context = tx.getReference(RecordingContext, context.id);
            current.dispatch = data.dispatchId
              ? tx.getReference(Dispatch, data.dispatchId)
              : null;
            current.currentActivityId = eventId;
            current.occurredAt = new Date(data.occurredAt);
            current.data = data;
            current.version += 1;
            current.review = 'pending';
            current.reviewedBy = null;
            current.reviewedAt = null;
          }

          tx.persist(
            tx.create(ActivityRevision, {
              id: eventId,
              record: current,
              context: tx.getReference(RecordingContext, context.id),
              digest,
              baseVersion,
              submission: { data: originalData },
              conflict: false,
            }),
          );

          await tx.flush();

          current.flags = await this.computeRecordFlags(tx, current, context);
          await tx.flush();
          await this.priceRecord(tx, current);
          await this.refreshLinkedRun(tx, current);

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

    if (accepted.length > 0) this.events.changed();

    const session = await em.findOne(DrivingSession, {
      id: context.drivingSession.id,
    });
    const profile = await em.findOne(
      DriverProfile,
      { id: context.driver.id },
      { populate: ['user'] },
    );
    const stopCapture =
      !session ||
      Boolean(session.endedAt) ||
      !profile ||
      profile.status !== 'active' ||
      !profile.user.isActive;

    return {
      accepted,
      rejected,
      stopCapture,
      receivedAt: new Date().toISOString(),
    };
  }

  /** Stores private proof photos (POD, weighbridge slip, fuel/expense receipt, odometer photo). */
  async saveAttachments(
    ownerType: 'record' | 'expense' | 'shift',
    rawOwnerId: string,
    files: UploadedPhoto[],
    rawKind: unknown,
    auth:
      | { mode: 'admin'; context: AdminContext }
      | { mode: 'mobile'; context: AdminContext }
      | { mode: 'recording'; contextId: unknown; tokenHeader: unknown },
  ) {
    if (!files.length) {
      throw new BadRequestError('Attach at least one photo.');
    }
    const ownerId = assertUuid(rawOwnerId, 'Choose a valid record.');
    const kind: AttachmentKind = parseAttachmentKind(rawKind);
    const em = getEm(this.orm);

    let uploaderUserId: string | null = null;
    let recordingContext: RecordingContext | null = null;

    if (auth.mode === 'admin') {
      const canWrite =
        auth.context.permissions.includes('activities.review') ||
        auth.context.permissions.includes('expenses.write') ||
        auth.context.permissions.includes('shifts.read');
      if (!canWrite) {
        throw new ForbiddenError('You do not have permission to upload photos.');
      }
      uploaderUserId = auth.context.user.id;
    } else if (auth.mode === 'mobile') {
      await this.activeDriverProfile(auth.context, em);
      uploaderUserId = auth.context.user.id;
    } else {
      recordingContext = await this.authenticateRecordingToken(
        auth.contextId,
        auth.tokenHeader,
        em,
      );
    }

    const validated = files.map((file) => {
      const mimeType = photoType(file);
      return {
        buffer: file.buffer,
        mimeType,
        ext: mimeToExtension[mimeType],
        byteSize: file.buffer.length,
      };
    });

    const created = await em.transactional(async (tx) => {
      let record: TransportRecord | null = null;
      let truckExpense: TruckExpense | null = null;
      let drivingSession: DrivingSession | null = null;

      if (ownerType === 'record') {
        record = await tx.findOne(TransportRecord, { id: ownerId });
        if (!record) throw new NotFoundError('Activity record not found.');
        if (
          recordingContext &&
          record.driver.id !== recordingContext.driver.id
        ) {
          throw new ForbiddenError('Cannot attach photos to another driver record.');
        }
        if (auth.mode === 'mobile') {
          const driver = await this.activeDriverProfile(auth.context, tx);
          if (record.driver.id !== driver.id) {
            throw new ForbiddenError('Cannot attach photos to another driver record.');
          }
        }
      } else if (ownerType === 'expense') {
        if (auth.mode !== 'admin') {
          throw new ForbiddenError('Only administrators can attach expense invoices.');
        }
        truckExpense = await tx.findOne(TruckExpense, { id: ownerId });
        if (!truckExpense) throw new NotFoundError('Expense not found.');
      } else {
        drivingSession = await tx.findOne(DrivingSession, { id: ownerId });
        if (!drivingSession) throw new NotFoundError('Driving shift not found.');
        if (
          recordingContext &&
          drivingSession.driver.id !== recordingContext.driver.id
        ) {
          throw new ForbiddenError('Cannot attach photos to another driver shift.');
        }
        if (auth.mode === 'mobile') {
          const driver = await this.activeDriverProfile(auth.context, tx);
          if (drivingSession.driver.id !== driver.id) {
            throw new ForbiddenError('Cannot attach photos to another driver shift.');
          }
        }
      }

      const dir = transportAttachmentDir(ownerId);
      await ensurePrivateDirectory(dir);

      const saved: TransportAttachment[] = [];
      for (const item of validated) {
        const storageName = `${randomUUID()}.${item.ext}`;
        await writePrivateFile(join(dir, storageName), item.buffer);
        const attachment = tx.create(TransportAttachment, {
          record,
          truckExpense,
          drivingSession,
          kind,
          mimeType: item.mimeType,
          byteSize: item.byteSize,
          storageName,
          uploadedByUser: uploaderUserId
            ? tx.getReference(User, uploaderUserId)
            : null,
        });
        tx.persist(attachment);
        saved.push(attachment);
      }

      // Clear missing odometer photo flag automatically when photo arrives.
      if (drivingSession) {
        if (kind === 'start_odometer_photo') {
          drivingSession.mileageFlags = drivingSession.mileageFlags.filter(
            (f) => f !== 'missing_start_photo',
          );
        } else if (kind === 'end_odometer_photo') {
          drivingSession.mileageFlags = drivingSession.mileageFlags.filter(
            (f) => f !== 'missing_end_photo',
          );
        }
      }

      await tx.flush();
      return saved;
    });

    this.events.changed();
    return { items: created.map(toAttachmentDto) };
  }

  async readAttachment(context: AdminContext, rawAttachmentId: string) {
    const allowed =
      context.permissions.includes('activities.read') ||
      context.permissions.includes('expenses.read') ||
      context.permissions.includes('shifts.read') ||
      context.permissions.includes('revenue.read');
    if (!allowed) {
      throw new ForbiddenError('Attachment access is required.');
    }
    const id = assertUuid(rawAttachmentId, 'Choose a valid attachment.');
    const attachment = await getEm(this.orm).findOne(TransportAttachment, {
      id,
    });
    if (!attachment) throw new NotFoundError('Photo not found.');
    const ownerId =
      attachment.record?.id ??
      attachment.truckExpense?.id ??
      attachment.drivingSession?.id;
    if (!ownerId) throw new NotFoundError('Photo not found.');
    const buffer = await readPrivateFile(
      join(transportAttachmentDir(ownerId), attachment.storageName),
    );
    return { type: attachment.mimeType, buffer };
  }

  async listRecords(
    context: AdminContext,
    query: Record<string, string | undefined> = {},
  ) {
    if (!context.permissions.includes('activities.read')) {
      throw new ForbiddenError('Activity access is required.');
    }
    const em = getEm(this.orm);
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const driverId = uuidField(query.driverId, 'driver', false);
    const kind =
      query.kind &&
      ['collection', 'delivery', 'fuel', 'expense'].includes(query.kind)
        ? query.kind
        : null;
    const review =
      query.review &&
      ['pending', 'validated', 'clarification', 'void'].includes(query.review)
        ? query.review
        : null;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const from =
      query.from && datePattern.test(query.from) ? query.from : null;
    const to = query.to && datePattern.test(query.to) ? query.to : null;
    const flaggedOnly = query.flagged === 'true';

    const showMoney = context.permissions.includes('revenue.read');

    const rows = await rawQuery<{
      id: string;
      driverId: string;
      truckId: string;
      contextId: string;
      dispatchId: string | null;
      kind: string;
      occurredAt: string;
      data: ActivityData;
      version: number;
      review: string;
      flags: string[];
      reviewedById: string | null;
      reviewedAt: string | null;
      updatedAt: string;
      registration: string;
      truckIdentifier: string;
      driverName: string;
      amount: string | null;
      pricingStatus: string | null;
      attachmentCount: number;
    }>(
      em,
      `SELECT r.id, r."driverId", r."truckId", r."contextId", r."dispatchId",
              r.kind, r."occurredAt", r.data, r.version, r.review, r.flags,
              r."reviewedById", r."reviewedAt", r."updatedAt",
              t.registration, t.identifier AS "truckIdentifier",
              concat(u."firstName", ' ', u."lastName") AS "driverName",
              c.amount::text AS amount, c.status AS "pricingStatus",
              (SELECT count(*)::int FROM app.transport_attachments a WHERE a."recordId" = r.id) AS "attachmentCount"
       FROM app.transport_records r
       JOIN app.trucks t ON t.id = r."truckId"
       JOIN app.driver_profiles dp ON dp.id = r."driverId"
       JOIN app.users u ON u.id = dp."userId"
       LEFT JOIN app.transport_charges c ON c."recordId" = r.id
       WHERE ($1::uuid IS NULL OR r."truckId" = $1::uuid)
         AND ($2::uuid IS NULL OR r."driverId" = $2::uuid)
         AND ($3::text IS NULL OR r.kind = $3::text)
         AND ($4::text IS NULL OR r.review = $4::text)
         AND ($5::date IS NULL OR (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $5::date)
         AND ($6::date IS NULL OR (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date <= $6::date)
         AND (NOT $7::boolean OR cardinality(r.flags) > 0)
       ORDER BY r."occurredAt" DESC, r.id DESC
       LIMIT 250`,
      [truckId, driverId, kind, review, from, to, flaggedOnly],
    );

    return rows.map((row) => ({
      id: row.id,
      driverId: row.driverId,
      truckId: row.truckId,
      contextId: row.contextId,
      dispatchId: row.dispatchId,
      kind: row.kind,
      occurredAt: new Date(row.occurredAt).toISOString(),
      data: row.data,
      version: row.version,
      review: row.review,
      flags: row.flags,
      reviewedById: row.reviewedById,
      reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
      updatedAt: new Date(row.updatedAt).toISOString(),
      registration: row.registration,
      truckIdentifier: row.truckIdentifier,
      driverName: row.driverName,
      attachmentCount: row.attachmentCount,
      ...(showMoney
        ? { amount: row.amount, pricingStatus: row.pricingStatus }
        : {}),
    }));
  }

  async recordDetail(context: AdminContext, rawRecordId: string) {
    if (!context.permissions.includes('activities.read')) {
      throw new ForbiddenError('Activity access is required.');
    }
    const id = assertUuid(rawRecordId, 'Choose a valid activity.');
    const em = getEm(this.orm);
    const record = await em.findOne(
      TransportRecord,
      { id },
      { populate: ['truck', 'driver.user'] },
    );
    if (!record) throw new NotFoundError('Activity record not found.');

    const showMoney = context.permissions.includes('revenue.read');
    const [revisions, attachments, charge, audits] = await Promise.all([
      em.find(
        ActivityRevision,
        { record: record.id },
        { orderBy: { receivedAt: 'asc' } },
      ),
      em.find(
        TransportAttachment,
        { record: record.id },
        { orderBy: { createdAt: 'asc' } },
      ),
      showMoney
        ? em.findOne(TransportCharge, { record: record.id })
        : Promise.resolve(undefined),
      em.find(
        TransportAudit,
        { recordId: record.id, entityType: 'transport_record' },
        { populate: ['actor'], orderBy: { createdAt: 'asc' } },
      ),
    ]);

    return {
      record: toRecordDto(record, {
        registration: record.truck.registration,
        truckIdentifier: record.truck.identifier,
        driverName: userFullName(record.driver.user),
        ...(showMoney ? { charge: charge ?? null } : {}),
        attachmentCount: attachments.length,
      }),
      revisions: revisions.map((rev) => ({
        id: rev.id,
        baseVersion: rev.baseVersion,
        conflict: rev.conflict,
        submission: rev.submission,
        receivedAt: rev.receivedAt,
      })),
      attachments: attachments.map(toAttachmentDto),
      audits: audits.map((a) => ({
        id: a.id,
        action: a.action,
        reason: a.reason,
        actorName: userFullName(a.actor),
        before: a.before,
        after: a.after,
        createdAt: a.createdAt,
      })),
      ...(showMoney
        ? {
            charge: charge
              ? {
                  status: charge.status,
                  amount: charge.amount,
                  rateId: charge.rate?.id ?? null,
                  snapshot: charge.snapshot,
                }
              : null,
          }
        : {}),
    };
  }

  async reviewRecord(context: AdminContext, rawRecordId: string, raw: unknown) {
    if (!context.permissions.includes('activities.review')) {
      throw new ForbiddenError('Activity review access is required.');
    }
    const id = assertUuid(rawRecordId, 'Choose a valid activity.');
    const input = parseReviewInput(raw);
    if (input.reprice && !context.permissions.includes('pricing.write')) {
      throw new ForbiddenError('Rate management access is required to reprice.');
    }

    const updated = await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-transport-records-v1');
      const record = await tx.findOne(
        TransportRecord,
        { id },
        { populate: ['truck', 'driver.user'] },
      );
      if (!record) throw new NotFoundError('Activity record not found.');
      if (record.version !== input.version) {
        throw new ConflictError(
          'This activity changed. Refresh and try again.',
        );
      }

      const prevCharge = await tx.findOne(TransportCharge, {
        record: record.id,
      });
      const before = {
        version: record.version,
        review: record.review,
        truckId: record.truck.id,
        data: structuredClone(record.data),
        flags: [...record.flags],
        charge: prevCharge
          ? { status: prevCharge.status, amount: prevCharge.amount }
          : null,
      };

      if (input.data) {
        if (input.data.kind !== record.kind) {
          throw new BadRequestError('An activity type cannot change.');
        }
        record.data = input.data;
        record.occurredAt = new Date(input.data.occurredAt);
        record.dispatch = input.data.dispatchId
          ? tx.getReference(Dispatch, input.data.dispatchId)
          : null;
      }

      if (input.truckId) {
        const truck = await tx.findOne(Truck, { id: input.truckId });
        if (!truck) throw new BadRequestError('Choose a valid vehicle.');
        record.truck = truck;
      }

      await this.validateCatalogueRefs(tx, record.data);
      const recordingContext = await tx.findOneOrFail(RecordingContext, {
        id: record.context.id,
      });
      record.flags = await this.computeRecordFlags(tx, record, recordingContext);
      if (input.action === 'validated') {
        assertCanValidateRecord(record.flags);
      }

      record.review = input.action;
      record.reviewedBy = tx.getReference(User, context.user.id);
      record.reviewedAt = new Date();
      record.version += 1;
      await tx.flush();

      await this.priceRecord(tx, record, input.reprice);
      const nextCharge = await tx.findOne(TransportCharge, {
        record: record.id,
      });

      tx.persist(
        tx.create(TransportAudit, {
          recordId: record.id,
          entityType: 'transport_record',
          actor: tx.getReference(User, context.user.id),
          action: input.reprice ? 'reprice' : input.action,
          reason: input.reason,
          before,
          after: {
            version: record.version,
            review: record.review,
            truckId: record.truck.id,
            data: structuredClone(record.data),
            flags: [...record.flags],
            charge: nextCharge
              ? { status: nextCharge.status, amount: nextCharge.amount }
              : null,
          },
        }),
      );
      await tx.flush();
      await this.refreshLinkedRun(tx, record, context.user.id);

      return toRecordDto(record, {
        registration: record.truck.registration,
        truckIdentifier: record.truck.identifier,
        driverName: userFullName(record.driver.user),
        ...(context.permissions.includes('revenue.read')
          ? { charge: nextCharge ?? null }
          : {}),
      });
    });

    this.events.changed();
    return updated;
  }

  async driverReviewResults(context: AdminContext, rawIds: string) {
    const em = getEm(this.orm);
    const profile = await this.activeDriverProfile(context, em);
    const ids = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100)
      .map((entry) => assertUuid(entry, 'Choose a valid record.'));
    if (!ids.length) return [];

    const records = await em.find(TransportRecord, {
      driver: profile.id,
      id: { $in: ids },
    });
    return records.map((r) => ({
      id: r.id,
      version: r.version,
      review: r.review,
      flags: r.flags,
      reviewedAt: r.reviewedAt,
    }));
  }
}
