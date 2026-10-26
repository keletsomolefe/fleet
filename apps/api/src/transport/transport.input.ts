import { BadRequestException } from '@nestjs/common';
import { uuidPattern } from '../fleet/fleet.input.js';

export const units = {
  tonne: ['mass', 1000],
  kg: ['mass', 1],
  litre: ['volume', 1],
  m3: ['volume', 1000],
  pallet: ['pallet', 1],
  item: ['item', 1],
} as const;
export type Unit = keyof typeof units;
export type Ref = { id: string | null; name: string };
export interface ActivityData {
  kind: 'collection' | 'delivery' | 'fuel';
  occurredAt: string;
  dispatchId: string | null;
  runId: string | null;
  customer: Ref;
  product: Ref;
  origin: Ref;
  destination: Ref;
  supplier: Ref;
  receiver: Ref;
  quantity: string | null;
  unit: Unit;
  collectedQuantity: string | null;
  allocations: { deliveryId: string; quantity: string }[];
  outcome: 'completed' | 'partial' | 'failed' | 'cancelled';
  transportCharge: boolean;
  fuelLitres: string | null;
  fuelTotalCost: string | null;
  odometerKm: string | null;
  note: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}
export interface DispatchPlan {
  customer: Ref;
  product: Ref;
  origin: Ref;
  supplier: Ref;
  unit: Unit;
  quantity: string;
  instructions: string;
  collectionId: string;
  deliveries: {
    id: string;
    destination: Ref;
    receiver: Ref;
    quantity: string;
    collectedQuantity: string | null;
  }[];
}
export function fail(message = 'Check the details.'): never {
  throw new BadRequestException(message);
}
export function object(raw: unknown, keys?: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const v = raw as Record<string, unknown>;
  if (keys && Object.keys(v).some((k) => !keys.includes(k)))
    fail('Unexpected fields.');
  return v;
}
export function text(raw: unknown, max = 200, required = false): string {
  if (raw == null || raw === '') {
    if (required) fail('Enter the required details.');
    return '';
  }
  if (
    typeof raw !== 'string' ||
    raw.trim().length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw)
  )
    fail();
  if (required && !raw.trim()) fail('Enter the required details.');
  return raw.trim();
}
export function id(raw: unknown): string {
  if (typeof raw !== 'string' || !uuidPattern.test(raw))
    fail('Choose a valid record.');
  return raw;
}
export function optionalId(raw: unknown): string | null {
  return raw == null || raw === '' ? null : id(raw);
}
export function decimal(raw: unknown, optional = true): string | null {
  if ((raw == null || raw === '') && optional) return null;
  const value = String(raw);
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value))
    fail('Enter a positive amount with up to six decimal places.');
  return value;
}
export function date(raw: unknown): string {
  const value = text(raw, 10, true);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value ||
    value < '2000-01-01' ||
    value > '2200-01-01'
  )
    fail('Enter a valid date.');
  return value;
}
export function instant(raw: unknown): string {
  const value = text(raw, 40, true);
  if (
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) > Date.now() + 300000 ||
    Date.parse(value) < Date.parse('2000-01-01')
  )
    fail('Enter a valid activity time.');
  return new Date(value).toISOString();
}
export function choice<T extends string>(
  raw: unknown,
  choices: readonly T[],
): T {
  if (typeof raw !== 'string' || !choices.includes(raw as T))
    fail('Choose a valid option.');
  return raw as T;
}
export function unit(raw: unknown): Unit {
  return choice(raw, Object.keys(units) as Unit[]);
}
export function version(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0)
    fail('Refresh the record and try again.');
  return Number(raw);
}
export function bool(raw: unknown, fallback = true): boolean {
  if (raw == null) return fallback;
  if (typeof raw !== 'boolean') fail();
  return raw;
}
export function ref(raw: unknown): Ref {
  const v = object(raw ?? {}, ['id', 'name']);
  return { id: optionalId(v.id), name: text(v.name) };
}
function coordinate(raw: unknown, min: number, max: number): number | null {
  if (raw == null || raw === '') return null;
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max
  )
    fail('Check the location.');
  return raw;
}
export function activity(raw: unknown): ActivityData {
  const v = object(raw, [
    'kind',
    'occurredAt',
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
    'allocations',
    'outcome',
    'transportCharge',
    'fuelLitres',
    'fuelTotalCost',
    'odometerKm',
    'note',
    'latitude',
    'longitude',
    'accuracy',
  ]);
  if (
    v.allocations != null &&
    (!Array.isArray(v.allocations) || v.allocations.length > 50)
  )
    fail();
  const allocations = ((v.allocations ?? []) as unknown[]).map((a) => {
    const x = object(a, ['deliveryId', 'quantity']);
    return {
      deliveryId: id(x.deliveryId),
      quantity: decimal(x.quantity, false)!,
    };
  });
  if (new Set(allocations.map((a) => a.deliveryId)).size !== allocations.length)
    fail('Each delivery needs one load share.');
  const latitude = coordinate(v.latitude, -90, 90),
    longitude = coordinate(v.longitude, -180, 180);
  if ((latitude == null) !== (longitude == null)) fail('Check the location.');
  return {
    kind: choice(v.kind, ['collection', 'delivery', 'fuel']),
    occurredAt: instant(v.occurredAt),
    dispatchId: optionalId(v.dispatchId),
    runId: optionalId(v.runId),
    customer: ref(v.customer),
    product: ref(v.product),
    origin: ref(v.origin),
    destination: ref(v.destination),
    supplier: ref(v.supplier),
    receiver: ref(v.receiver),
    quantity: decimal(v.quantity),
    unit: unit(v.unit ?? 'tonne'),
    collectedQuantity: decimal(v.collectedQuantity),
    allocations,
    outcome: choice(v.outcome ?? 'completed', [
      'completed',
      'partial',
      'failed',
      'cancelled',
    ]),
    transportCharge: bool(v.transportCharge),
    fuelLitres: decimal(v.fuelLitres),
    fuelTotalCost: decimal(v.fuelTotalCost),
    odometerKm: decimal(v.odometerKm),
    note: text(v.note, 2000),
    latitude,
    longitude,
    accuracy: coordinate(v.accuracy, 0, 100000),
  };
}
export function localDate(at: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}
