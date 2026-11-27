import { BadRequestError } from '../../../shared/errors.js';
import { isUuid } from '../../../shared/identifiers.js';
import {
  booleanOrDefault,
  enumChoice,
  optionalFiniteNumber,
  optionalText,
  parseCalendarDateField,
  requiredNote,
  requiredText,
  strictObject,
  uuidField,
} from '../../../shared/validation.js';
import {
  activityKinds,
  activityOutcomes,
  attachmentKinds,
  reviewStatuses,
  roadExpenseCategories,
  type ActivityData,
  type AttachmentKind,
  type ReviewStatus,
  type TransportAttachment,
  type TransportCharge,
  type TransportRecord,
} from '../domain/activity.entity.js';
import {
  siteTypes,
  type Customer,
  type CustomerProduct,
  type Location,
  type Product,
  type SiteType,
} from '../domain/catalogue.entity.js';
import {
  dispatchStatuses,
  type CatalogueRef,
  type Dispatch,
  type DispatchPlan,
  type DispatchStatus,
} from '../domain/dispatch.entity.js';
import {
  truckExpenseCategories,
  type TruckExpense,
  type TruckExpenseCategory,
} from '../domain/expense.entity.js';
import { unitKeys, type Unit } from '../domain/pricing.js';
import {
  rateBases,
  rateMethods,
  type RateBasis,
  type RateMethod,
  type TransportRate,
} from '../domain/rate.entity.js';

export function parseDecimalField(
  raw: unknown,
  options: { required?: boolean; maxDecimals?: number; label?: string } = {},
): string | null {
  const { required = false, maxDecimals = 6, label = 'amount' } = options;
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new BadRequestError(`Enter a valid ${label}.`);
    return null;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new BadRequestError(
      `Enter a non-negative ${label} with up to ${maxDecimals} decimal places.`,
    );
  }
  const value = String(raw).trim();
  const pattern = new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDecimals}})?$`);
  if (!pattern.test(value)) {
    throw new BadRequestError(
      `Enter a non-negative ${label} with up to ${maxDecimals} decimal places.`,
    );
  }
  return value;
}

export function parseVersion(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0) {
    throw new BadRequestError('Refresh the record and try again.');
  }
  return Number(raw);
}

export function parseActivityInstant(raw: unknown, required = true): string | null {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new BadRequestError('Enter a valid activity time.');
    return null;
  }
  if (typeof raw !== 'string') {
    throw new BadRequestError('Enter a valid activity time.');
  }
  const trimmed = raw.trim();
  if (
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(trimmed) ||
    !Number.isFinite(Date.parse(trimmed)) ||
    Date.parse(trimmed) > Date.now() + 300_000 ||
    Date.parse(trimmed) < Date.parse('2000-01-01')
  ) {
    throw new BadRequestError('Enter a valid activity time.');
  }
  return new Date(trimmed).toISOString();
}

export function parseRef(raw: unknown): CatalogueRef {
  if (raw === undefined || raw === null) return { id: null, name: '' };
  const v = strictObject(raw, ['id', 'name'], 'Enter the reference details.');
  return {
    id: uuidField(v.id, 'record', false),
    name: optionalText(v, 'name', 200) ?? '',
  };
}

export function localOperationalDate(at: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

export function parseMonthString(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.trim())) {
    throw new BadRequestError('Choose a valid month (YYYY-MM).');
  }
  return raw.trim();
}

export interface CustomerInput {
  name: string;
  industry: string;
  contact: string;
  email: string;
  phone: string;
  notes: string;
  active: boolean;
  version: number | null;
}

export function parseCustomerInput(raw: unknown): CustomerInput {
  const v = strictObject(raw, [
    'name',
    'industry',
    'contact',
    'email',
    'phone',
    'notes',
    'active',
    'version',
  ]);
  return {
    name: requiredText(v, 'name', 200, {
      missingMessage: 'Enter a customer name.',
    }),
    industry: optionalText(v, 'industry', 120) ?? '',
    contact: optionalText(v, 'contact', 200) ?? '',
    email: optionalText(v, 'email', 200) ?? '',
    phone: optionalText(v, 'phone', 40) ?? '',
    notes: optionalText(v, 'notes', 2000) ?? '',
    active: booleanOrDefault(v.active, true),
    version: v.version == null ? null : parseVersion(v.version),
  };
}

export interface LocationInput {
  name: string;
  siteType: SiteType;
  directions: string;
  contact: string;
  phone: string;
  customerIds: string[];
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  version: number | null;
}

export function parseLocationInput(raw: unknown): LocationInput {
  const v = strictObject(raw, [
    'name',
    'siteType',
    'directions',
    'contact',
    'phone',
    'customerIds',
    'latitude',
    'longitude',
    'active',
    'version',
  ]);
  const latitude = optionalFiniteNumber(
    v.latitude,
    -90,
    90,
    'Check the latitude.',
  );
  const longitude = optionalFiniteNumber(
    v.longitude,
    -180,
    180,
    'Check the longitude.',
  );
  if ((latitude == null) !== (longitude == null)) {
    throw new BadRequestError('Enter both latitude and longitude.');
  }
  if (v.customerIds != null && !Array.isArray(v.customerIds)) {
    throw new BadRequestError('Choose valid customers for this location.');
  }
  const customerIds = [
    ...new Set(
      ((v.customerIds ?? []) as unknown[]).map((entry) => {
        if (!isUuid(entry)) {
          throw new BadRequestError('Choose valid customers for this location.');
        }
        return entry;
      }),
    ),
  ];
  return {
    name: requiredText(v, 'name', 200, {
      missingMessage: 'Enter a location name.',
    }),
    siteType: enumChoice(v.siteType, siteTypes, 'site type', {
      fallback: 'both',
    }),
    directions: optionalText(v, 'directions', 2000) ?? '',
    contact: optionalText(v, 'contact', 200) ?? '',
    phone: optionalText(v, 'phone', 40) ?? '',
    customerIds,
    latitude,
    longitude,
    active: booleanOrDefault(v.active, true),
    version: v.version == null ? null : parseVersion(v.version),
  };
}

export interface ProductInput {
  name: string;
  unit: Unit;
  active: boolean;
  version: number | null;
}

export function parseProductInput(raw: unknown): ProductInput {
  const v = strictObject(raw, ['name', 'unit', 'active', 'version']);
  return {
    name: requiredText(v, 'name', 200, {
      missingMessage: 'Enter a product name.',
    }),
    unit: enumChoice(v.unit, unitKeys, 'unit', { fallback: 'tonne' }),
    active: booleanOrDefault(v.active, true),
    version: v.version == null ? null : parseVersion(v.version),
  };
}

export interface CustomerProductInput {
  customerId: string;
  productId: string;
  supplies: boolean;
  receives: boolean;
  active: boolean;
  version: number | null;
}

export function parseCustomerProductInput(raw: unknown): CustomerProductInput {
  const v = strictObject(raw, [
    'customerId',
    'productId',
    'supplies',
    'receives',
    'active',
    'version',
  ]);
  const supplies = booleanOrDefault(v.supplies, false);
  const receives = booleanOrDefault(v.receives, false);
  if (!supplies && !receives) {
    throw new BadRequestError(
      'Select whether the customer supplies, receives, or both.',
    );
  }
  return {
    customerId: uuidField(v.customerId, 'customer', true)!,
    productId: uuidField(v.productId, 'product', true)!,
    supplies,
    receives,
    active: booleanOrDefault(v.active, true),
    version: v.version == null ? null : parseVersion(v.version),
  };
}

export interface CreateRateInput {
  customerProductId: string;
  originId: string | null;
  destinationId: string | null;
  method: RateMethod;
  basis: RateBasis;
  unit: Unit;
  price: string;
  startsOn: string;
  endsOn: string | null;
}

export function parseCreateRateInput(raw: unknown): CreateRateInput {
  const v = strictObject(raw, [
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
  const originId = uuidField(v.originId, 'collection site', false);
  const destinationId = uuidField(v.destinationId, 'delivery site', false);
  if ((originId == null) !== (destinationId == null)) {
    throw new BadRequestError(
      'Choose both a collection site and delivery site, or leave both blank for a default rate.',
    );
  }
  const startsOn = parseCalendarDateField(v, 'startsOn', true)!;
  const endsOn = parseCalendarDateField(v, 'endsOn', false);
  if (endsOn && endsOn < startsOn) {
    throw new BadRequestError('End date cannot be earlier than start date.');
  }
  return {
    customerProductId: uuidField(v.customerProductId, 'customer product', true)!,
    originId,
    destinationId,
    method: enumChoice(v.method, rateMethods, 'pricing method', {
      fallback: 'quantity',
    }),
    basis: enumChoice(v.basis, rateBases, 'quantity basis', {
      fallback: 'delivered',
    }),
    unit: enumChoice(v.unit, unitKeys, 'unit', { fallback: 'tonne' }),
    price: parseDecimalField(v.price, {
      required: true,
      maxDecimals: 6,
      label: 'rate price',
    })!,
    startsOn,
    endsOn,
  };
}

export function parseEndRateInput(raw: unknown): string {
  const v = strictObject(raw, ['endsOn']);
  return parseCalendarDateField(v, 'endsOn', true)!;
}

export interface DispatchInput {
  reference: string | null;
  date: string;
  driverId: string;
  truckId: string;
  status: DispatchStatus;
  version: number | null;
  plan: DispatchPlan;
}

export function parseDispatchInput(raw: unknown): DispatchInput {
  const v = strictObject(raw, [
    'reference',
    'date',
    'driverId',
    'truckId',
    'status',
    'version',
    'plan',
  ]);
  const planRaw = strictObject(
    v.plan,
    [
      'customer',
      'product',
      'supplier',
      'origin',
      'quantity',
      'unit',
      'instructions',
      'collectionId',
      'deliveries',
    ],
    'Enter the dispatch load details.',
  );
  if (
    !Array.isArray(planRaw.deliveries) ||
    planRaw.deliveries.length === 0 ||
    planRaw.deliveries.length > 50
  ) {
    throw new BadRequestError('Add at least one delivery stop.');
  }
  const deliveries = planRaw.deliveries.map((entry) => {
    const d = strictObject(entry, [
      'id',
      'destination',
      'receiver',
      'quantity',
      'collectedQuantity',
    ]);
    return {
      id: uuidField(d.id, 'delivery stop', true)!,
      destination: parseRef(d.destination),
      receiver: parseRef(d.receiver),
      quantity: parseDecimalField(d.quantity, {
        required: true,
        label: 'delivery quantity',
      })!,
      collectedQuantity: parseDecimalField(d.collectedQuantity, {
        required: false,
        label: 'collected share',
      }),
    };
  });
  return {
    reference: optionalText(v, 'reference', 80),
    date: parseCalendarDateField(v, 'date', true)!,
    driverId: uuidField(v.driverId, 'driver', true)!,
    truckId: uuidField(v.truckId, 'vehicle', true)!,
    status: enumChoice(v.status, dispatchStatuses, 'status', {
      fallback: 'dispatched',
    }),
    version: v.version == null ? null : parseVersion(v.version),
    plan: {
      customer: parseRef(planRaw.customer),
      product: parseRef(planRaw.product),
      supplier: parseRef(planRaw.supplier),
      origin: parseRef(planRaw.origin),
      quantity: parseDecimalField(planRaw.quantity, {
        required: true,
        label: 'planned quantity',
      })!,
      unit: enumChoice(planRaw.unit, unitKeys, 'unit', { fallback: 'tonne' }),
      instructions: optionalText(planRaw, 'instructions', 2000) ?? '',
      collectionId: uuidField(planRaw.collectionId, 'collection ID', true)!,
      deliveries,
    },
  };
}

export function parseActivityData(raw: unknown): ActivityData {
  const v = strictObject(raw, [
    'kind',
    'occurredAt',
    'arrivedAt',
    'departedAt',
    'dispatchId',
    'runId',
    'customer',
    'product',
    'origin',
    'destination',
    'supplier',
    'receiver',
    'quantity',
    'unit',
    'collectedQuantity',
    'grossWeight',
    'tareWeight',
    'waybillNumber',
    'allocations',
    'outcome',
    'transportCharge',
    'fuelLitres',
    'fuelTotalCost',
    'fuelStation',
    'expenseCategory',
    'expenseAmount',
    'vendorName',
    'receiptNumber',
    'odometerKm',
    'note',
    'latitude',
    'longitude',
    'accuracy',
  ]);
  if (
    v.allocations != null &&
    (!Array.isArray(v.allocations) || v.allocations.length > 50)
  ) {
    throw new BadRequestError('Check the load share allocations.');
  }
  const allocations = ((v.allocations ?? []) as unknown[]).map((item) => {
    const a = strictObject(item, ['deliveryId', 'quantity']);
    return {
      deliveryId: uuidField(a.deliveryId, 'delivery', true)!,
      quantity: parseDecimalField(a.quantity, {
        required: true,
        label: 'load share',
      })!,
    };
  });
  if (new Set(allocations.map((a) => a.deliveryId)).size !== allocations.length) {
    throw new BadRequestError('Each delivery needs one load share.');
  }
  const latitude = optionalFiniteNumber(
    v.latitude,
    -90,
    90,
    'Check the location.',
  );
  const longitude = optionalFiniteNumber(
    v.longitude,
    -180,
    180,
    'Check the location.',
  );
  if ((latitude == null) !== (longitude == null)) {
    throw new BadRequestError('Check the location.');
  }
  const kind = enumChoice(v.kind, activityKinds, 'activity type');
  const expenseCategory = enumChoice(
    v.expenseCategory,
    roadExpenseCategories,
    'expense category',
    { optional: true },
  );
  return {
    kind,
    occurredAt: parseActivityInstant(v.occurredAt, true)!,
    arrivedAt: parseActivityInstant(v.arrivedAt, false),
    departedAt: parseActivityInstant(v.departedAt, false),
    dispatchId: uuidField(v.dispatchId, 'dispatch', false),
    runId: uuidField(v.runId, 'collection run', false),
    customer: parseRef(v.customer),
    product: parseRef(v.product),
    origin: parseRef(v.origin),
    destination: parseRef(v.destination),
    supplier: parseRef(v.supplier),
    receiver: parseRef(v.receiver),
    quantity: parseDecimalField(v.quantity, { label: 'quantity' }),
    unit: enumChoice(v.unit, unitKeys, 'unit', { fallback: 'tonne' }),
    collectedQuantity: parseDecimalField(v.collectedQuantity, {
      label: 'collected quantity',
    }),
    grossWeight: parseDecimalField(v.grossWeight, { label: 'gross weight' }),
    tareWeight: parseDecimalField(v.tareWeight, { label: 'tare weight' }),
    waybillNumber: optionalText(v, 'waybillNumber', 80) ?? '',
    allocations,
    outcome: enumChoice(v.outcome, activityOutcomes, 'outcome', {
      fallback: 'completed',
    }),
    transportCharge: booleanOrDefault(v.transportCharge, true),
    fuelLitres: parseDecimalField(v.fuelLitres, {
      maxDecimals: 3,
      label: 'fuel litres',
    }),
    fuelTotalCost: parseDecimalField(v.fuelTotalCost, {
      maxDecimals: 2,
      label: 'fuel cost',
    }),
    fuelStation: optionalText(v, 'fuelStation', 160) ?? '',
    expenseCategory,
    expenseAmount: parseDecimalField(v.expenseAmount, {
      maxDecimals: 2,
      label: 'expense amount',
    }),
    vendorName: optionalText(v, 'vendorName', 160) ?? '',
    receiptNumber: optionalText(v, 'receiptNumber', 80) ?? '',
    odometerKm: parseDecimalField(v.odometerKm, {
      maxDecimals: 1,
      label: 'odometer reading',
    }),
    note: optionalText(v, 'note', 2000) ?? '',
    latitude,
    longitude,
    accuracy: optionalFiniteNumber(v.accuracy, 0, 100_000, 'Check the location.'),
  };
}

export interface ReviewRecordInput {
  version: number;
  action: ReviewStatus;
  reason: string;
  data: ActivityData | null;
  truckId: string | null;
  reprice: boolean;
}

export function parseReviewInput(raw: unknown): ReviewRecordInput {
  const v = strictObject(raw, [
    'version',
    'action',
    'reason',
    'data',
    'truckId',
    'reprice',
  ]);
  return {
    version: parseVersion(v.version),
    action: enumChoice(v.action, reviewStatuses, 'review decision'),
    reason: requiredNote(v.reason, 1000, 'Enter a reason for this review.'),
    data: v.data ? parseActivityData(v.data) : null,
    truckId: uuidField(v.truckId, 'vehicle', false),
    reprice: booleanOrDefault(v.reprice, false),
  };
}

export interface TruckExpenseInput {
  truckId: string;
  driverId: string | null;
  serviceJobId: string | null;
  occurredOn: string;
  category: TruckExpenseCategory;
  vendor: string;
  invoiceNumber: string;
  amount: string;
  litres: string | null;
  odometerKm: string | null;
  notes: string;
}

export function parseTruckExpenseInput(raw: unknown): TruckExpenseInput {
  const v = strictObject(raw, [
    'truckId',
    'driverId',
    'serviceJobId',
    'occurredOn',
    'category',
    'vendor',
    'invoiceNumber',
    'amount',
    'litres',
    'odometerKm',
    'notes',
  ]);
  return {
    truckId: uuidField(v.truckId, 'vehicle', true)!,
    driverId: uuidField(v.driverId, 'driver', false),
    serviceJobId: uuidField(v.serviceJobId, 'service job', false),
    occurredOn: parseCalendarDateField(v, 'occurredOn', true)!,
    category: enumChoice(v.category, truckExpenseCategories, 'category'),
    vendor: optionalText(v, 'vendor', 160) ?? '',
    invoiceNumber: optionalText(v, 'invoiceNumber', 80) ?? '',
    amount: parseDecimalField(v.amount, {
      required: true,
      maxDecimals: 2,
      label: 'expense amount',
    })!,
    litres: parseDecimalField(v.litres, { maxDecimals: 3, label: 'litres' }),
    odometerKm: parseDecimalField(v.odometerKm, {
      maxDecimals: 1,
      label: 'odometer reading',
    }),
    notes: optionalText(v, 'notes', 2000) ?? '',
  };
}

export function parseVoidReason(raw: unknown): string {
  const v = strictObject(raw, ['reason']);
  return requiredNote(v.reason, 500, 'Enter a reason to void this expense.');
}

export function parseAttachmentKind(raw: unknown): AttachmentKind {
  return enumChoice(raw, attachmentKinds, 'attachment type', {
    fallback: 'other',
  });
}

// Explicit DTO mappers — never spread ORM entities directly.

export function toCustomerDto(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    industry: c.industry,
    contact: c.contact,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    active: c.active,
    version: c.version,
  };
}

export function toLocationDto(l: Location) {
  return {
    id: l.id,
    name: l.name,
    siteType: l.siteType,
    directions: l.directions,
    contact: l.contact,
    phone: l.phone,
    customerIds: [...l.customerIds],
    latitude: l.latitude,
    longitude: l.longitude,
    active: l.active,
    version: l.version,
  };
}

export function toProductDto(p: Product) {
  return {
    id: p.id,
    name: p.name,
    unit: p.unit,
    active: p.active,
    version: p.version,
  };
}

export function toCustomerProductDto(cp: CustomerProduct) {
  return {
    id: cp.id,
    customerId: cp.customer.id,
    productId: cp.product.id,
    supplies: cp.supplies,
    receives: cp.receives,
    active: cp.active,
    version: cp.version,
  };
}

export function toRateDto(r: TransportRate) {
  return {
    id: r.id,
    customerProductId: r.customerProduct.id,
    originId: r.origin?.id ?? null,
    destinationId: r.destination?.id ?? null,
    method: r.method,
    basis: r.basis,
    unit: r.unit,
    price: r.price,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    createdById: r.createdBy.id,
    createdAt: r.createdAt,
  };
}

export function toDispatchDto(d: Dispatch, allocationConflict = false) {
  return {
    id: d.id,
    reference: d.reference,
    date: d.date,
    driverId: d.driver.id,
    truckId: d.truck.id,
    status: d.status,
    version: d.version,
    plan: d.plan,
    allocationConflict,
    createdAt: d.createdAt,
  };
}

export function toAttachmentDto(a: TransportAttachment) {
  return {
    id: a.id,
    kind: a.kind,
    mimeType: a.mimeType,
    byteSize: a.byteSize,
    createdAt: a.createdAt,
  };
}

export function toRecordDto(
  record: TransportRecord,
  options: {
    registration: string;
    truckIdentifier: string;
    driverName: string;
    charge?: TransportCharge | null;
    attachmentCount?: number;
  },
) {
  return {
    id: record.id,
    driverId: record.driver.id,
    truckId: record.truck.id,
    contextId: record.context.id,
    dispatchId: record.dispatch?.id ?? null,
    kind: record.kind,
    occurredAt: record.occurredAt,
    data: record.data,
    version: record.version,
    review: record.review,
    flags: [...record.flags],
    reviewedById: record.reviewedBy?.id ?? null,
    reviewedAt: record.reviewedAt,
    updatedAt: record.updatedAt,
    registration: options.registration,
    truckIdentifier: options.truckIdentifier,
    driverName: options.driverName,
    ...(options.charge !== undefined
      ? {
          amount: options.charge?.amount ?? null,
          pricingStatus: options.charge?.status ?? null,
        }
      : {}),
    ...(options.attachmentCount !== undefined
      ? { attachmentCount: options.attachmentCount }
      : {}),
  };
}

export function toTruckExpenseDto(
  expense: TruckExpense,
  meta: {
    registration: string;
    truckIdentifier: string;
    driverName: string | null;
    serviceJobReference: string | null;
    attachments?: TransportAttachment[];
  },
) {
  return {
    id: expense.id,
    truckId: expense.truck.id,
    registration: meta.registration,
    truckIdentifier: meta.truckIdentifier,
    driverId: expense.driver?.id ?? null,
    driverName: meta.driverName,
    serviceJobId: expense.serviceJob?.id ?? null,
    serviceJobReference: meta.serviceJobReference,
    occurredOn: expense.occurredOn,
    category: expense.category,
    vendor: expense.vendor,
    invoiceNumber: expense.invoiceNumber,
    amount: expense.amount,
    litres: expense.litres,
    odometerKm: expense.odometerKm,
    notes: expense.notes,
    voidedAt: expense.voidedAt,
    voidReason: expense.voidReason,
    createdAt: expense.createdAt,
    attachments: (meta.attachments ?? []).map(toAttachmentDto),
  };
}
