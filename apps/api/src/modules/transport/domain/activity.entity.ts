import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  createdAtColumn,
  updatedAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { DrivingSession } from '../../driving/domain/driving-session.entity.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';
import { Dispatch, type CatalogueRef } from './dispatch.entity.js';
import { TruckExpense } from './expense.entity.js';
import type { Unit } from './pricing.js';
import { TransportRate } from './rate.entity.js';

export const activityKinds = [
  'collection',
  'delivery',
  'fuel',
  'expense',
] as const;
export type ActivityKind = (typeof activityKinds)[number];

export const activityOutcomes = [
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type ActivityOutcome = (typeof activityOutcomes)[number];

export const reviewStatuses = [
  'pending',
  'validated',
  'clarification',
  'void',
] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export const chargeStatuses = [
  'priced',
  'needs_pricing',
  'uncharged',
] as const;
export type ChargeStatus = (typeof chargeStatuses)[number];

export const roadExpenseCategories = [
  'toll',
  'repair',
  'tyres',
  'weighbridge',
  'parking',
  'permits',
  'other',
] as const;
export type RoadExpenseCategory = (typeof roadExpenseCategories)[number];

export const attachmentKinds = [
  'pod',
  'weighbridge_ticket',
  'fuel_receipt',
  'expense_receipt',
  'start_odometer_photo',
  'end_odometer_photo',
  'other',
] as const;
export type AttachmentKind = (typeof attachmentKinds)[number];

export interface LoadAllocation {
  deliveryId: string;
  quantity: string;
}

export interface ActivityData {
  kind: ActivityKind;
  occurredAt: string;
  arrivedAt: string | null;
  departedAt: string | null;
  dispatchId: string | null;
  runId: string | null;
  customer: CatalogueRef;
  product: CatalogueRef;
  origin: CatalogueRef;
  destination: CatalogueRef;
  supplier: CatalogueRef;
  receiver: CatalogueRef;
  quantity: string | null;
  unit: Unit;
  collectedQuantity: string | null;
  grossWeight: string | null;
  tareWeight: string | null;
  waybillNumber: string;
  allocations: LoadAllocation[];
  outcome: ActivityOutcome;
  transportCharge: boolean;
  fuelLitres: string | null;
  fuelTotalCost: string | null;
  fuelStation: string;
  expenseCategory: RoadExpenseCategory | null;
  expenseAmount: string | null;
  vendorName: string;
  receiptNumber: string;
  odometerKm: string | null;
  note: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

export const RecordingContext = defineEntity({
  name: 'RecordingContext',
  tableName: 'recording_contexts',
  schema: 'app',
  uniques: [
    {
      name: 'recording_contexts_tokenHash_unique',
      properties: ['tokenHash'],
    },
  ],
  properties: {
    id: p.uuid().primary(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    drivingSession: () =>
      p
        .manyToOne(DrivingSession)
        .fieldName('drivingSessionId')
        .deleteRule('restrict'),
    tokenHash: p.string().length(64).hidden(),
    createdAt: createdAtColumn(),
  },
});

export type RecordingContext = InferEntity<typeof RecordingContext>;

export const TransportRecord = defineEntity({
  name: 'TransportRecord',
  tableName: 'transport_records',
  schema: 'app',
  indexes: [
    {
      name: 'ix_transport_records_truck_time',
      properties: ['truck', 'occurredAt'],
    },
    {
      name: 'ix_transport_records_driver_time',
      properties: ['driver', 'occurredAt'],
    },
    {
      name: 'ix_transport_records_review',
      properties: ['review', 'occurredAt'],
    },
  ],
  checks: [
    {
      name: 'transport_records_kind_check',
      expression: `kind IN ('collection', 'delivery', 'fuel', 'expense')`,
    },
    {
      name: 'transport_records_review_check',
      expression: `review IN ('pending', 'validated', 'clarification', 'void')`,
    },
  ],
  properties: {
    id: p.uuid().primary(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    context: () =>
      p
        .manyToOne(RecordingContext)
        .fieldName('contextId')
        .deleteRule('restrict'),
    dispatch: () =>
      p
        .manyToOne(Dispatch)
        .fieldName('dispatchId')
        .strictNullable()
        .deleteRule('set null'),
    currentActivityId: p.uuid(),
    kind: p.string().length(20).$type<ActivityKind>(),
    occurredAt: p.datetime().columnType('timestamptz'),
    data: p.json<ActivityData>(),
    version: p.integer().default(1),
    review: p.string().length(20).$type<ReviewStatus>().default('pending'),
    flags: p.string().array().$type<string>().default([]),
    reviewedBy: () =>
      p
        .manyToOne(User)
        .fieldName('reviewedById')
        .strictNullable()
        .deleteRule('set null'),
    reviewedAt: p.datetime().columnType('timestamptz').strictNullable(),
    updatedAt: updatedAtColumn(),
  },
});

export type TransportRecord = InferEntity<typeof TransportRecord>;

export const ActivityRevision = defineEntity({
  name: 'ActivityRevision',
  tableName: 'activity_revisions',
  schema: 'app',
  indexes: [
    {
      name: 'ix_activity_revisions_record',
      properties: ['record', 'receivedAt'],
    },
  ],
  checks: [
    {
      name: 'activity_revisions_base_version_check',
      expression: '"baseVersion" >= 0',
    },
  ],
  properties: {
    id: p.uuid().primary(),
    record: () =>
      p
        .manyToOne(TransportRecord)
        .fieldName('recordId')
        .deleteRule('restrict'),
    context: () =>
      p
        .manyToOne(RecordingContext)
        .fieldName('contextId')
        .deleteRule('restrict'),
    digest: p.string().length(64),
    baseVersion: p.integer(),
    submission: p.json<Record<string, unknown>>(),
    conflict: p.boolean().default(false),
    receivedAt: createdAtColumn(),
  },
});

export type ActivityRevision = InferEntity<typeof ActivityRevision>;

export const TransportCharge = defineEntity({
  name: 'TransportCharge',
  tableName: 'transport_charges',
  schema: 'app',
  checks: [
    {
      name: 'transport_charges_status_check',
      expression: `status IN ('priced', 'needs_pricing', 'uncharged')`,
    },
    {
      name: 'transport_charges_amount_check',
      expression: 'amount IS NULL OR amount >= 0',
    },
    {
      name: 'transport_charges_priced_amount_check',
      expression: `(status = 'priced') = (amount IS NOT NULL)`,
    },
  ],
  properties: {
    record: () =>
      p
        .oneToOne(TransportRecord)
        .primary()
        .fieldName('recordId')
        .deleteRule('restrict'),
    rate: () =>
      p
        .manyToOne(TransportRate)
        .fieldName('rateId')
        .strictNullable()
        .deleteRule('set null'),
    status: p.string().length(20).$type<ChargeStatus>(),
    amount: p.decimal('string').precision(20).scale(2).strictNullable(),
    snapshot: p.json<Record<string, unknown>>().strictNullable(),
  },
});

export type TransportCharge = InferEntity<typeof TransportCharge>;

const attachmentKindsSql = attachmentKinds
  .map((value) => `'${value}'`)
  .join(', ');

export const TransportAttachment = defineEntity({
  name: 'TransportAttachment',
  tableName: 'transport_attachments',
  schema: 'app',
  indexes: [
    {
      name: 'ix_transport_attachments_record',
      properties: ['record'],
      where: '"recordId" IS NOT NULL',
    },
    {
      name: 'ix_transport_attachments_expense',
      properties: ['truckExpense'],
      where: '"truckExpenseId" IS NOT NULL',
    },
    {
      name: 'ix_transport_attachments_session',
      properties: ['drivingSession'],
      where: '"drivingSessionId" IS NOT NULL',
    },
  ],
  checks: [
    {
      name: 'transport_attachments_kind_check',
      expression: `kind IN (${attachmentKindsSql})`,
    },
    {
      name: 'transport_attachments_size_check',
      expression: '"byteSize" > 0',
    },
    {
      name: 'transport_attachments_single_owner_check',
      expression: `(("recordId" IS NOT NULL)::int + ("truckExpenseId" IS NOT NULL)::int + ("drivingSessionId" IS NOT NULL)::int) = 1`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    record: () =>
      p
        .manyToOne(TransportRecord)
        .fieldName('recordId')
        .strictNullable()
        .deleteRule('cascade'),
    truckExpense: () =>
      p
        .manyToOne(TruckExpense)
        .fieldName('truckExpenseId')
        .strictNullable()
        .deleteRule('cascade'),
    drivingSession: () =>
      p
        .manyToOne(DrivingSession)
        .fieldName('drivingSessionId')
        .strictNullable()
        .deleteRule('cascade'),
    kind: p.string().length(24).$type<AttachmentKind>().default('other'),
    mimeType: p.string().length(64),
    byteSize: p.integer(),
    storageName: p.string().length(80),
    uploadedByUser: () =>
      p
        .manyToOne(User)
        .fieldName('uploadedByUserId')
        .strictNullable()
        .deleteRule('set null'),
    createdAt: createdAtColumn(),
  },
});

export type TransportAttachment = InferEntity<typeof TransportAttachment>;

export const TransportAudit = defineEntity({
  name: 'TransportAudit',
  tableName: 'transport_audits',
  schema: 'app',
  indexes: [
    {
      name: 'ix_transport_audit_record',
      properties: ['recordId', 'createdAt'],
    },
  ],
  checks: [
    {
      name: 'transport_audits_entity_type_check',
      expression: `"entityType" IN ('transport_record', 'truck_expense', 'driving_session')`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    recordId: p.uuid(),
    entityType: p
      .string()
      .length(24)
      .$type<'transport_record' | 'truck_expense' | 'driving_session'>()
      .default('transport_record'),
    actor: () =>
      p.manyToOne(User).fieldName('actorId').deleteRule('restrict'),
    action: p.string().length(80),
    reason: p.text(),
    before: p.json<Record<string, unknown>>(),
    after: p.json<Record<string, unknown>>(),
    createdAt: createdAtColumn(),
  },
});

export type TransportAudit = InferEntity<typeof TransportAudit>;
