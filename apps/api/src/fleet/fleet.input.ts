import { BadRequestException } from '@nestjs/common';

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fieldLabel(key: string) {
  return key.replace(/[A-Z]/g, (s) => ` ${s.toLowerCase()}`);
}
function invalid(message: string): never {
  throw new BadRequestException(message);
}
function object(raw: unknown, keys: string[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    invalid('Enter the details.');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key)))
    invalid('Unexpected fields.');
  return value;
}
function text(
  v: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
): string | null {
  const value = v[key];
  if (value === undefined || value === null || value === '') {
    if (required)
      invalid(`Enter ${key.replace(/[A-Z]/g, (s) => ` ${s.toLowerCase()}`)}.`);
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    !value.trim() ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    invalid(`Invalid ${fieldLabel(key)}.`);
  return value.trim();
}
function choice(
  v: Record<string, unknown>,
  key: string,
  choices: string[],
  optional = false,
): string | null {
  const value = text(v, key, 30, !optional);
  if (value === null && optional) return null;
  if (!choices.includes(value!)) invalid(`Select a valid ${fieldLabel(key)}.`);
  return value;
}
function integer(
  v: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  required = false,
): number | null {
  const value = v[key];
  if (value === '' || value === null || value === undefined) {
    if (required) invalid(`Enter ${fieldLabel(key)}.`);
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    invalid(`Enter ${fieldLabel(key)} between ${min} and ${max}.`);
  return value;
}
function date(
  v: Record<string, unknown>,
  key: string,
  required = false,
): string | null {
  const value = text(v, key, 10, required);
  if (
    value &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '1900-01-01' ||
      value > '2200-12-31' ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)
  )
    invalid(`Enter a valid ${fieldLabel(key)}.`);
  return value;
}
function country(v: Record<string, unknown>, key: string) {
  const value = text(v, key, 2, true)!.toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) invalid('Use a two-letter country code.');
  return value;
}
function identifier(v: Record<string, unknown>, key: string) {
  const value = text(v, key, 40, true)!.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(value))
    invalid('Use letters, numbers, hyphens or underscores for the identifier.');
  return value;
}
function phone(v: Record<string, unknown>, key: string, required = false) {
  const value = text(v, key, 30, required);
  if (
    value &&
    (!/^\+?[\d ()-]{7,30}$/.test(value) ||
      value.replace(/\D/g, '').length < 7 ||
      value.replace(/\D/g, '').length > 15)
  )
    invalid('Enter a valid phone number.');
  return value;
}
export function parseTruck(raw: unknown) {
  const v = object(raw, [
    'identifier',
    'registration',
    'registrationCountry',
    'make',
    'model',
    'year',
    'vin',
    'engineNumber',
    'category',
    'fuelType',
    'transmission',
    'axleCount',
    'grossVehicleMassKg',
    'tareKg',
    'payloadCapacityKg',
    'odometerKm',
    'tankCapacityLitres',
    'licenceDiscExpiresOn',
    'roadworthyExpiresOn',
    'insuranceProvider',
    'insurancePolicyNumber',
    'insuranceExpiresOn',
    'serviceIntervalKm',
    'nextServiceDueKm',
    'status',
    'notes',
    'deviceIdentifier',
    'deviceSerialNumber',
  ]);
  const vin = text(v, 'vin', 17)?.toUpperCase() ?? null;
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
    invalid('Enter a 17-character VIN without I, O or Q.');
  const registration = text(v, 'registration', 30, true)!
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!/^[A-Z0-9 -]+$/.test(registration))
    invalid('Enter a valid registration.');
  const grossVehicleMassKg = integer(v, 'grossVehicleMassKg', 1, 200000);
  const tareKg = integer(v, 'tareKg', 1, 200000);
  const payloadCapacityKg = integer(v, 'payloadCapacityKg', 1, 200000);
  if (
    grossVehicleMassKg !== null &&
    (tareKg ?? 0) + (payloadCapacityKg ?? 0) > grossVehicleMassKg
  )
    invalid('Tare and payload must fit within gross vehicle mass.');
  const deviceIdentifier =
    text(v, 'deviceIdentifier', 80)?.toUpperCase() ?? null;
  const deviceSerialNumber =
    text(v, 'deviceSerialNumber', 100)?.toUpperCase() ?? null;
  if (deviceSerialNumber && !deviceIdentifier)
    invalid('Enter a device identifier with the serial number.');
  return {
    identifier: identifier(v, 'identifier'),
    registration,
    registrationCountry: country(v, 'registrationCountry'),
    make: text(v, 'make', 80, true)!,
    model: text(v, 'model', 80, true)!,
    year: integer(v, 'year', 1950, new Date().getUTCFullYear() + 1),
    vin,
    engineNumber: text(v, 'engineNumber', 80),
    category: choice(v, 'category', [
      'rigid',
      'tractor',
      'tipper',
      'tanker',
      'flatbed',
      'other',
    ])!,
    fuelType: choice(v, 'fuelType', [
      'diesel',
      'petrol',
      'electric',
      'hybrid',
      'other',
    ])!,
    transmission: choice(
      v,
      'transmission',
      ['manual', 'automatic', 'automated'],
      true,
    ),
    axleCount: integer(v, 'axleCount', 2, 20),
    grossVehicleMassKg,
    tareKg,
    payloadCapacityKg,
    odometerKm: integer(v, 'odometerKm', 0, 20000000, true)!,
    tankCapacityLitres: integer(v, 'tankCapacityLitres', 1, 10000),
    licenceDiscExpiresOn: date(v, 'licenceDiscExpiresOn'),
    roadworthyExpiresOn: date(v, 'roadworthyExpiresOn'),
    insuranceProvider: text(v, 'insuranceProvider', 100),
    insurancePolicyNumber: text(v, 'insurancePolicyNumber', 100),
    insuranceExpiresOn: date(v, 'insuranceExpiresOn'),
    serviceIntervalKm: integer(v, 'serviceIntervalKm', 1, 1000000),
    nextServiceDueKm: integer(v, 'nextServiceDueKm', 0, 20000000),
    status: choice(v, 'status', ['active', 'maintenance', 'inactive'])!,
    notes: text(v, 'notes', 2000),
    deviceIdentifier,
    deviceSerialNumber,
  };
}
export function parseDriver(raw: unknown, creating = false) {
  const v = object(raw, [
    'identifier',
    'phone',
    'licenceNumber',
    'licenceCode',
    'licenceCountry',
    'licenceExpiresOn',
    'prdpNumber',
    'prdpExpiresOn',
    'emergencyContactName',
    'emergencyContactPhone',
    'status',
    'currentTruckId',
    'notes',
    ...(creating ? ['userId', 'account'] : []),
  ]);
  const userId = creating ? text(v, 'userId', 36) : null;
  if (
    creating &&
    (!!userId === !!v.account || (userId && !uuidPattern.test(userId)))
  )
    invalid('Select a user or enter a new account.');
  const currentTruckId = text(v, 'currentTruckId', 36);
  if (currentTruckId && !uuidPattern.test(currentTruckId))
    invalid('Select a valid truck.');
  const prdpNumber = text(v, 'prdpNumber', 80),
    prdpExpiresOn = date(v, 'prdpExpiresOn');
  if (!!prdpNumber !== !!prdpExpiresOn)
    invalid('Enter both the PrDP number and expiry date.');
  const emergencyContactName = text(v, 'emergencyContactName', 100),
    emergencyContactPhone = phone(v, 'emergencyContactPhone');
  if (!!emergencyContactName !== !!emergencyContactPhone)
    invalid('Enter both emergency contact name and phone.');
  const profile = {
    identifier: identifier(v, 'identifier'),
    phone: phone(v, 'phone', true)!,
    licenceNumber: text(v, 'licenceNumber', 80, true)!.toUpperCase(),
    licenceCode: text(v, 'licenceCode', 10, true)!.toUpperCase(),
    licenceCountry: country(v, 'licenceCountry'),
    licenceExpiresOn: date(v, 'licenceExpiresOn', true)!,
    prdpNumber,
    prdpExpiresOn,
    emergencyContactName,
    emergencyContactPhone,
    status: choice(v, 'status', ['active', 'inactive'])!,
    currentTruckId,
    notes: text(v, 'notes', 2000),
  };
  if (profile.currentTruckId) validateAssignment(profile);
  return { profile, userId, account: v.account };
}
export function validateAssignment(profile: {
  status: string;
  licenceExpiresOn: string;
  prdpNumber: string | null;
  prdpExpiresOn: string | null;
}) {
  // Fleet dates use South African operational time, including around UTC midnight.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (profile.status !== 'active')
    invalid('Only active drivers can be assigned a truck.');
  if (
    profile.licenceExpiresOn < today ||
    !profile.prdpNumber ||
    !profile.prdpExpiresOn ||
    profile.prdpExpiresOn < today
  )
    invalid('A current licence and PrDP are required for truck assignment.');
}
export function parseSearch(
  q: unknown = '',
  page: unknown = '1',
  status: unknown = '',
) {
  if (
    typeof q !== 'string' ||
    q.length > 200 ||
    typeof page !== 'string' ||
    !/^[1-9]\d{0,5}$/.test(page) ||
    typeof status !== 'string' ||
    !['', 'active', 'inactive', 'maintenance'].includes(status)
  )
    invalid('Invalid search.');
  return { q: q.trim(), page: Number(page), status };
}
