import { adminGet } from './admin-fetch';

export type Unit = 'tonne' | 'kg' | 'litre' | 'm3' | 'pallet' | 'item';
export type SiteType = 'collection' | 'delivery' | 'both' | 'fuel_station' | 'yard';
export type ActivityKind = 'collection' | 'delivery' | 'fuel' | 'expense';
export type ActivityOutcome = 'completed' | 'partial' | 'failed' | 'cancelled';
export type ReviewStatus = 'pending' | 'validated' | 'clarification' | 'void';
export type RoadExpenseCategory =
  | 'toll'
  | 'repair'
  | 'tyres'
  | 'weighbridge'
  | 'parking'
  | 'permits'
  | 'other';
export type TruckExpenseCategory =
  | 'fuel'
  | 'repair'
  | 'tyres'
  | 'toll'
  | 'weighbridge'
  | 'maintenance'
  | 'insurance'
  | 'licence'
  | 'permits'
  | 'parking'
  | 'other';

export type CatalogueRef = { id: string | null; name: string };

export type CustomerDto = {
  id: string;
  name: string;
  industry: string;
  contact: string;
  email: string;
  phone: string;
  notes: string;
  active: boolean;
  version: number;
};

export type LocationDto = {
  id: string;
  name: string;
  siteType: SiteType;
  directions: string;
  contact: string;
  phone: string;
  customerIds: string[];
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  version: number;
};

export type ProductDto = {
  id: string;
  name: string;
  unit: Unit;
  active: boolean;
  version: number;
};

export type CustomerProductDto = {
  id: string;
  customerId: string;
  productId: string;
  supplies: boolean;
  receives: boolean;
  active: boolean;
  version: number;
};

export type TruckOptionDto = {
  id: string;
  identifier: string;
  registration: string;
  status: string;
  odometerKm: number;
};

export type DriverOptionDto = {
  id: string;
  identifier: string;
  name: string;
  status: string;
};

export type TransportCatalogue = {
  customers: CustomerDto[];
  locations: LocationDto[];
  products: ProductDto[];
  customerProducts: CustomerProductDto[];
  units: Unit[];
  trucks?: TruckOptionDto[];
  drivers?: DriverOptionDto[];
};

export type TransportRateDto = {
  id: string;
  customerProductId: string;
  originId: string | null;
  destinationId: string | null;
  method: 'quantity' | 'delivery';
  basis: 'collected' | 'delivered';
  unit: Unit;
  price: string;
  startsOn: string;
  endsOn: string | null;
  createdById: string;
  createdAt: string;
};

export type DispatchStopDto = {
  id: string;
  destination: CatalogueRef;
  receiver: CatalogueRef;
  quantity: string;
  collectedQuantity: string | null;
};

export type DispatchDto = {
  id: string;
  reference: string;
  date: string;
  driverId: string;
  truckId: string;
  status: 'draft' | 'dispatched' | 'completed' | 'cancelled';
  version: number;
  allocationConflict?: boolean;
  plan: {
    customer: CatalogueRef;
    product: CatalogueRef;
    supplier: CatalogueRef;
    origin: CatalogueRef;
    quantity: string;
    unit: Unit;
    instructions: string;
    collectionId: string;
    deliveries: DispatchStopDto[];
  };
  createdAt: string;
};

export type DispatchListResponse = {
  items: DispatchDto[];
  drivers: Array<{ id: string; identifier: string; name: string }>;
  trucks: Array<{ id: string; identifier: string; registration: string }>;
};

export type ActivityDataDto = {
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
  allocations: Array<{ deliveryId: string; quantity: string }>;
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
};

export type ActivityRecordRow = {
  id: string;
  driverId: string;
  truckId: string;
  contextId: string;
  dispatchId: string | null;
  kind: ActivityKind;
  occurredAt: string;
  data: ActivityDataDto;
  version: number;
  review: ReviewStatus;
  flags: string[];
  reviewedById: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  registration: string;
  truckIdentifier: string;
  driverName: string;
  attachmentCount?: number;
  amount?: string | null;
  pricingStatus?: 'priced' | 'needs_pricing' | 'uncharged' | null;
};

export type AttachmentDto = {
  id: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
};

export type ActivityDetailResponse = {
  record: ActivityRecordRow;
  revisions: Array<{
    id: string;
    baseVersion: number;
    conflict: boolean;
    submission: Record<string, unknown>;
    receivedAt: string;
  }>;
  attachments: AttachmentDto[];
  audits: Array<{
    id: string;
    action: string;
    reason: string;
    actorName: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    createdAt: string;
  }>;
  charge?: {
    status: 'priced' | 'needs_pricing' | 'uncharged';
    amount: string | null;
    rateId: string | null;
    snapshot: Record<string, unknown> | null;
  } | null;
};

export type TimelineEventDto = {
  id: string;
  eventType:
    | 'shift_start'
    | 'shift_end'
    | 'collection'
    | 'delivery'
    | 'fuel'
    | 'expense'
    | 'service_job';
  timestamp: string;
  sessionId?: string;
  recordId?: string;
  serviceJobId?: string;
  truckId: string;
  registration: string;
  truckIdentifier: string;
  driverId: string | null;
  driverName: string | null;
  review?: ReviewStatus;
  summary: string;
  flags: string[];
  attachmentCount: number;
  details: Record<string, unknown>;
};

export type ShiftRowDto = {
  id: string;
  confirmedDate: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  truck: TruckOptionDto & { make: string; model: string };
  driver: { id: string; identifier: string; name: string };
  startOdometerKm: string | null;
  startOdometerAt: string | null;
  startOdometerMissingPhotoReason: string | null;
  endOdometerKm: string | null;
  endOdometerAt: string | null;
  endOdometerMissingPhotoReason: string | null;
  endOdometerLowerReason: string | null;
  distanceKm: number | null;
  mileageFlags: string[];
  mileageReviewedAt: string | null;
  mileageReviewedByName: string | null;
  mileageReviewNote: string | null;
  startPhoto: { id: string; kind: string; mimeType: string; createdAt: string } | null;
  endPhoto: { id: string; kind: string; mimeType: string; createdAt: string } | null;
};

export type UnifiedExpenseRow = {
  id: string;
  source: 'office_expense' | 'driver_fuel' | 'driver_expense' | 'service_job';
  occurredOn: string;
  occurredAt: string | null;
  truckId: string;
  registration: string;
  truckIdentifier: string;
  driverName: string | null;
  category: string;
  vendor: string;
  reference: string;
  amount: string;
  litres: string | null;
  odometerKm: string | null;
  notes: string;
  attachmentCount: number;
  serviceJobId: string | null;
  recordId: string | null;
  voidedAt: string | null;
};

export type TruckMonthlySummary = {
  truckId: string;
  truckName: string;
  registration: string;
  deliveries: number;
  tonnesDelivered: string;
  kmDriven: string;
  revenue: string;
  validated: string;
  awaitingReview: string;
  unpriced: number;
  fuelLitres: string;
  fuelSpend: string;
  avgFuelPricePerLitre: string | null;
  kmPerLitre: string | null;
  missingFuelPrices: number;
  repairSpend: string;
  serviceJobCount: number;
  otherExpenseSpend: string;
  totalSpend: string;
  estimatedNetMargin: string;
  revenuePerKm: string | null;
  costPerKm: string | null;
  lastRecordAt: string | null;
};

export type MonthlyEarningsReport = {
  month: string;
  currency: string;
  generatedAt: string;
  summary: {
    deliveries: number;
    tonnesDelivered: string;
    kmDriven: string;
    revenue: string;
    validated: string;
    awaitingReview: string;
    unpriced: number;
    fuelLitres: string;
    fuelSpend: string;
    avgFuelPricePerLitre: string | null;
    repairSpend: string;
    serviceJobCount: number;
    otherExpenseSpend: string;
    totalSpend: string;
    estimatedNetMargin: string;
  };
  totals: TruckMonthlySummary[];
  byCustomer: Array<{
    truckId: string;
    name: string;
    deliveries: number;
    tonnes: string;
    amount: string;
    unpriced: number;
  }>;
  byProduct: Array<{
    truckId: string;
    name: string;
    deliveries: number;
    tonnes: string;
    amount: string;
    unpriced: number;
  }>;
  byExpenseCategory: Array<{
    category: string;
    count: number;
    amount: string;
  }>;
  records: Array<ActivityRecordRow & { truckName: string; customerName: string | null; productName: string | null }>;
};

export const unitLabels: Record<Unit, string> = {
  tonne: 'Tonnes',
  kg: 'Kilograms',
  litre: 'Litres',
  m3: 'Cubic metres',
  pallet: 'Pallets',
  item: 'Items',
};

export const siteTypeLabels: Record<SiteType, string> = {
  collection: 'Collection site',
  delivery: 'Delivery site',
  both: 'Collection & delivery',
  fuel_station: 'Fuel station',
  yard: 'Depot / yard',
};

export const activityKindLabels: Record<ActivityKind, string> = {
  collection: 'Collection',
  delivery: 'Delivery',
  fuel: 'Fuel / Petrol',
  expense: 'Road expense',
};

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  pending: 'Pending review',
  validated: 'Validated',
  clarification: 'Clarification needed',
  void: 'Void',
};

export const expenseCategoryLabels: Record<string, string> = {
  fuel: 'Fuel / Petrol',
  repair: 'Repairs',
  tyres: 'Tyres',
  toll: 'Tolls',
  weighbridge: 'Weighbridge',
  maintenance: 'Maintenance',
  insurance: 'Insurance',
  licence: 'Licence & permits',
  permits: 'Permits',
  parking: 'Parking',
  other: 'Other',
};

export const flagLabels: Record<string, string> = {
  unmatched_customer: 'Unmatched customer',
  unmatched_product: 'Unmatched product',
  unmatched_origin: 'Unmatched collection site',
  unmatched_destination: 'Unmatched delivery site',
  unmatched_supplier: 'Unmatched supplier',
  unmatched_receiver: 'Unmatched receiver',
  missing_customer_product: 'No customer-product link',
  load_allocation_mismatch: 'Load share mismatch',
  missing_load_shares: 'Missing load shares',
  collection_allocation_conflict: 'Collection conflict',
  delivered_exceeds_collection: 'Delivered exceeds collected',
  weight_variance_alert: 'Weight variance (>2%)',
  outside_confirmed_session: 'Outside confirmed shift',
  conflicting_revision: 'Conflicting edit',
  missing_change_reason: 'Missing change reason',
  missing_pod_number: 'No POD / waybill #',
  missing_fuel_price: 'Fuel price missing',
  missing_fuel_litres: 'Fuel litres missing',
  missing_expense_amount: 'Expense amount missing',
  missing_start_odometer: 'No start km',
  missing_start_photo: 'No start km photo',
  missing_end_odometer: 'No end km',
  missing_end_photo: 'No end km photo',
  lower_end_odometer: 'End km lower than start',
  odometer_below_truck_last: 'Below last recorded km',
};

export function formatZar(amount: string | number | null | undefined): string {
  if (amount == null || amount === '') return '—';
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(num);
}

export function currentOperationalMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

export function currentOperationalDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function attachmentUrl(id: string): string {
  return `/api/admin/transport/attachments/${id}`;
}

export function earningsCsvUrl(month: string, truckId?: string): string {
  const params = new URLSearchParams({ month });
  if (truckId) params.set('truckId', truckId);
  return `/api/admin/transport/earnings/export?${params.toString()}`;
}

function buildQuery(params: Record<string, string | boolean | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== false) sp.set(k, String(v));
  }
  const str = sp.toString();
  return str ? `?${str}` : '';
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  csrf?: string,
): Promise<T> {
  if (!options.method || options.method.toUpperCase() === 'GET') {
    return adminGet<T>(path);
  }
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`/api/admin/${path}`, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : response.status === 403
          ? 'You do not have access to this action.'
          : 'Could not complete this request. Please try again.',
    );
  }
  return body as T;
}

export const getTransportCatalogue = () =>
  apiRequest<TransportCatalogue>('transport/catalogue');

export const saveMaster = <T>(
  csrf: string,
  kind: 'customers' | 'locations' | 'products' | 'customer-products',
  body: Record<string, unknown>,
  id?: string,
) =>
  apiRequest<T>(
    id ? `transport/master/${kind}/${id}` : `transport/master/${kind}`,
    { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) },
    csrf,
  );

export const getTransportRates = () =>
  apiRequest<TransportRateDto[]>('transport/rates');

export const createTransportRate = (csrf: string, body: Record<string, unknown>) =>
  apiRequest<TransportRateDto>(
    'transport/rates',
    { method: 'POST', body: JSON.stringify(body) },
    csrf,
  );

export const endTransportRate = (csrf: string, id: string, endsOn: string) =>
  apiRequest<TransportRateDto>(
    `transport/rates/${id}`,
    { method: 'PATCH', body: JSON.stringify({ endsOn }) },
    csrf,
  );

export const getDispatches = () =>
  apiRequest<DispatchListResponse>('transport/dispatches');

export const saveDispatch = (
  csrf: string,
  body: Record<string, unknown>,
  id?: string,
) =>
  apiRequest<DispatchDto>(
    id ? `transport/dispatches/${id}` : 'transport/dispatches',
    { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) },
    csrf,
  );

export const getActivityRecords = (
  filters: Record<string, string | boolean | undefined> = {},
) =>
  apiRequest<ActivityRecordRow[]>(`transport/records${buildQuery(filters)}`);

export const getActivityDetail = (id: string) =>
  apiRequest<ActivityDetailResponse>(`transport/records/${id}`);

export const reviewActivityRecord = (
  csrf: string,
  id: string,
  body: Record<string, unknown>,
) =>
  apiRequest<ActivityRecordRow>(
    `transport/records/${id}/review`,
    { method: 'POST', body: JSON.stringify(body) },
    csrf,
  );

export const getDriverTimeline = (
  filters: Record<string, string | undefined> = {},
) =>
  apiRequest<{ items: TimelineEventDto[] }>(
    `transport/timeline${buildQuery(filters)}`,
  );

export const getShifts = (
  filters: Record<string, string | boolean | undefined> = {},
) => apiRequest<{ items: ShiftRowDto[] }>(`shifts${buildQuery(filters)}`);

export const reviewShiftMileage = (
  csrf: string,
  id: string,
  body: Record<string, unknown>,
) =>
  apiRequest<Record<string, unknown>>(
    `shifts/${id}/review`,
    { method: 'POST', body: JSON.stringify(body) },
    csrf,
  );

export const getExpenses = (
  filters: Record<string, string | boolean | undefined> = {},
) =>
  apiRequest<{ items: UnifiedExpenseRow[]; officeExpenses: unknown[] }>(
    `transport/expenses${buildQuery(filters)}`,
  );

export const createTruckExpense = (csrf: string, body: Record<string, unknown>) =>
  apiRequest<{ id: string }>(
    'transport/expenses',
    { method: 'POST', body: JSON.stringify(body) },
    csrf,
  );

export const voidTruckExpense = (csrf: string, id: string, reason: string) =>
  apiRequest<Record<string, unknown>>(
    `transport/expenses/${id}/void`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    csrf,
  );

export const uploadTransportAttachment = (
  csrf: string,
  ownerType: 'record' | 'expense' | 'shift',
  ownerId: string,
  file: File,
  kind: string,
) => {
  const form = new FormData();
  form.append('kind', kind);
  form.append('photos', file);
  return apiRequest<{ items: AttachmentDto[] }>(
    `transport/attachments/${ownerType}/${ownerId}`,
    { method: 'POST', body: form },
    csrf,
  );
};

export const getMonthlyEarnings = (month: string, truckId?: string) =>
  apiRequest<MonthlyEarningsReport>(
    `transport/earnings${buildQuery({ month, truckId })}`,
  );

export type ReportDataset =
  | 'earnings'
  | 'activities'
  | 'expenses'
  | 'shifts'
  | 'dispatches';

export type ReportFormat = 'xlsx' | 'csv';

export type ReportPreviewDto = {
  dataset: ReportDataset;
  title: string;
  subtitle: string;
  generatedAt: string;
  currency: 'ZAR';
  activeFilters: Array<{ label: string; value: string }>;
  kpis: Array<{ label: string; value: string; hint?: string }>;
  totalRows: number;
  columns: Array<{ key: string; header: string; format?: string }>;
  rows: Array<Record<string, string | number | boolean | null>>;
  truncated: boolean;
};

export function reportExportUrl(
  dataset: ReportDataset,
  format: ReportFormat,
  filters: Record<string, string | boolean | undefined> = {},
): string {
  return `/api/admin/transport/reports/export${buildQuery({
    dataset,
    format,
    ...filters,
  })}`;
}

export const getReportPreview = (
  dataset: ReportDataset,
  filters: Record<string, string | boolean | undefined> = {},
) =>
  apiRequest<ReportPreviewDto>(
    `transport/reports/preview${buildQuery({ dataset, ...filters })}`,
  );

export async function downloadReportFile(
  dataset: ReportDataset,
  format: ReportFormat,
  filters: Record<string, string | boolean | undefined> = {},
): Promise<string> {
  const url = reportExportUrl(dataset, format, filters);
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    let message = 'Could not generate report.';
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // Non-JSON error body
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="?([^";\n]+)"?/i);
  const filename = match?.[1] ?? `vhh-fleet-${dataset}.${format}`;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return filename;
}
