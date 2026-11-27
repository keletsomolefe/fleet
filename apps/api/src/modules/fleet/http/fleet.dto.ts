import { BadRequestError } from '../../../shared/errors.js';
import { isUuid, uuidPattern } from '../../../shared/identifiers.js';
import {
  boundedInteger,
  fieldLabel,
  optionalText,
  parseCalendarDateField,
  phoneField,
  requiredText,
  strictObject,
} from '../../../shared/validation.js';
import type { DriverTruckAssignment } from '../domain/assignment.entity.js';
import type {
  DeviceTruckAssociation,
  TruckDevice,
} from '../domain/device.entity.js';
import {
  assertDriverEligibleForAssignment,
  driverStatuses,
  type DriverProfile,
  type DriverStatus,
} from '../domain/driver.entity.js';
import {
  fuelTypes,
  transmissionTypes,
  truckCategories,
  truckStatuses,
  type FuelType,
  type TransmissionType,
  type Truck,
  type TruckCategory,
  type TruckStatus,
} from '../domain/truck.entity.js';

export { uuidPattern };

function invalid(message: string): never {
  throw new BadRequestError(message);
}

function choiceField<T extends string>(
  v: Record<string, unknown>,
  key: string,
  choices: readonly T[],
  optional = false,
): T | null {
  const value = optional ? optionalText(v, key, 30) : requiredText(v, key, 30);
  if (value === null && optional) return null;
  if (!choices.includes(value as T)) {
    invalid(`Select a valid ${fieldLabel(key)}.`);
  }
  return value as T;
}

function countryCode(v: Record<string, unknown>, key: string): string {
  const value = requiredText(v, key, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) invalid('Use a two-letter country code.');
  return value;
}

function identifierCode(v: Record<string, unknown>, key: string): string {
  const value = requiredText(v, key, 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(value)) {
    invalid('Use letters, numbers, hyphens or underscores for the identifier.');
  }
  return value;
}

export interface SaveTruckDto {
  identifier: string;
  registration: string;
  registrationCountry: string;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  engineNumber: string | null;
  category: TruckCategory;
  fuelType: FuelType;
  transmission: TransmissionType | null;
  axleCount: number | null;
  grossVehicleMassKg: number | null;
  tareKg: number | null;
  payloadCapacityKg: number | null;
  odometerKm: number;
  tankCapacityLitres: number | null;
  licenceDiscExpiresOn: string | null;
  roadworthyExpiresOn: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiresOn: string | null;
  serviceIntervalKm: number | null;
  nextServiceDueKm: number | null;
  status: TruckStatus;
  notes: string | null;
  deviceIdentifier: string | null;
  deviceSerialNumber: string | null;
}

export interface DriverProfileInputDto {
  identifier: string;
  phone: string;
  licenceNumber: string;
  licenceCode: string;
  licenceCountry: string;
  licenceExpiresOn: string;
  prdpNumber: string | null;
  prdpExpiresOn: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  status: DriverStatus;
  currentTruckId: string | null;
  notes: string | null;
}

export interface SaveDriverDto {
  profile: DriverProfileInputDto;
  userId: string | null;
  account: unknown;
}

export function parseTruck(raw: unknown): SaveTruckDto {
  const v = strictObject(raw, [
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

  const vin = optionalText(v, 'vin', 17)?.toUpperCase() ?? null;
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    invalid('Enter a 17-character VIN without I, O or Q.');
  }

  const registration = requiredText(v, 'registration', 30)
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!/^[A-Z0-9 -]+$/.test(registration)) {
    invalid('Enter a valid registration.');
  }

  const grossVehicleMassKg = boundedInteger(v, 'grossVehicleMassKg', 1, 200000);
  const tareKg = boundedInteger(v, 'tareKg', 1, 200000);
  const payloadCapacityKg = boundedInteger(v, 'payloadCapacityKg', 1, 200000);
  if (
    grossVehicleMassKg !== null &&
    (tareKg ?? 0) + (payloadCapacityKg ?? 0) > grossVehicleMassKg
  ) {
    invalid('Tare and payload must fit within gross vehicle mass.');
  }

  const deviceIdentifier =
    optionalText(v, 'deviceIdentifier', 80)?.toUpperCase() ?? null;
  const deviceSerialNumber =
    optionalText(v, 'deviceSerialNumber', 100)?.toUpperCase() ?? null;
  if (deviceSerialNumber && !deviceIdentifier) {
    invalid('Enter a device identifier with the serial number.');
  }

  return {
    identifier: identifierCode(v, 'identifier'),
    registration,
    registrationCountry: countryCode(v, 'registrationCountry'),
    make: requiredText(v, 'make', 80),
    model: requiredText(v, 'model', 80),
    year: boundedInteger(v, 'year', 1950, new Date().getUTCFullYear() + 1),
    vin,
    engineNumber: optionalText(v, 'engineNumber', 80),
    category: choiceField(v, 'category', truckCategories)!,
    fuelType: choiceField(v, 'fuelType', fuelTypes)!,
    transmission: choiceField(v, 'transmission', transmissionTypes, true),
    axleCount: boundedInteger(v, 'axleCount', 2, 20),
    grossVehicleMassKg,
    tareKg,
    payloadCapacityKg,
    odometerKm: boundedInteger(v, 'odometerKm', 0, 20000000, true)!,
    tankCapacityLitres: boundedInteger(v, 'tankCapacityLitres', 1, 10000),
    licenceDiscExpiresOn: parseCalendarDateField(v, 'licenceDiscExpiresOn'),
    roadworthyExpiresOn: parseCalendarDateField(v, 'roadworthyExpiresOn'),
    insuranceProvider: optionalText(v, 'insuranceProvider', 100),
    insurancePolicyNumber: optionalText(v, 'insurancePolicyNumber', 100),
    insuranceExpiresOn: parseCalendarDateField(v, 'insuranceExpiresOn'),
    serviceIntervalKm: boundedInteger(v, 'serviceIntervalKm', 1, 1000000),
    nextServiceDueKm: boundedInteger(v, 'nextServiceDueKm', 0, 20000000),
    status: choiceField(v, 'status', truckStatuses)!,
    notes: optionalText(v, 'notes', 2000),
    deviceIdentifier,
    deviceSerialNumber,
  };
}

export function parseDriver(raw: unknown, creating = false): SaveDriverDto {
  const v = strictObject(raw, [
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

  const userId = creating ? optionalText(v, 'userId', 36) : null;
  if (creating && (Boolean(userId) === Boolean(v.account) || (userId && !isUuid(userId)))) {
    invalid('Select a user or enter a new account.');
  }

  const currentTruckId = optionalText(v, 'currentTruckId', 36);
  if (currentTruckId && !isUuid(currentTruckId)) {
    invalid('Select a valid truck.');
  }

  const prdpNumber = optionalText(v, 'prdpNumber', 80);
  const prdpExpiresOn = parseCalendarDateField(v, 'prdpExpiresOn');
  if (Boolean(prdpNumber) !== Boolean(prdpExpiresOn)) {
    invalid('Enter both the PrDP number and expiry date.');
  }

  const emergencyContactName = optionalText(v, 'emergencyContactName', 100);
  const emergencyContactPhone = phoneField(v, 'emergencyContactPhone');
  if (Boolean(emergencyContactName) !== Boolean(emergencyContactPhone)) {
    invalid('Enter both emergency contact name and phone.');
  }

  const profile: DriverProfileInputDto = {
    identifier: identifierCode(v, 'identifier'),
    phone: phoneField(v, 'phone', true)!,
    licenceNumber: requiredText(v, 'licenceNumber', 80).toUpperCase(),
    licenceCode: requiredText(v, 'licenceCode', 10).toUpperCase(),
    licenceCountry: countryCode(v, 'licenceCountry'),
    licenceExpiresOn: parseCalendarDateField(v, 'licenceExpiresOn', true)!,
    prdpNumber,
    prdpExpiresOn,
    emergencyContactName,
    emergencyContactPhone,
    status: choiceField(v, 'status', driverStatuses)!,
    currentTruckId,
    notes: optionalText(v, 'notes', 2000),
  };

  if (profile.currentTruckId) assertDriverEligibleForAssignment(profile);
  return { profile, userId, account: v.account };
}

export function validateAssignment(profile: {
  status: string;
  licenceExpiresOn: string;
  prdpNumber: string | null;
  prdpExpiresOn: string | null;
}) {
  assertDriverEligibleForAssignment(profile);
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
  ) {
    invalid('Invalid search.');
  }
  return { q: q.trim(), page: Number(page), status };
}

/** Response mappers — never spread raw ORM entities into HTTP payloads. */
export function toTruckDto(truck: Truck) {
  return {
    id: truck.id,
    identifier: truck.identifier,
    registration: truck.registration,
    registrationCountry: truck.registrationCountry,
    make: truck.make,
    model: truck.model,
    year: truck.year,
    vin: truck.vin,
    engineNumber: truck.engineNumber,
    category: truck.category,
    fuelType: truck.fuelType,
    transmission: truck.transmission,
    axleCount: truck.axleCount,
    grossVehicleMassKg: truck.grossVehicleMassKg,
    tareKg: truck.tareKg,
    payloadCapacityKg: truck.payloadCapacityKg,
    odometerKm: truck.odometerKm,
    tankCapacityLitres: truck.tankCapacityLitres,
    licenceDiscExpiresOn: truck.licenceDiscExpiresOn,
    roadworthyExpiresOn: truck.roadworthyExpiresOn,
    insuranceProvider: truck.insuranceProvider,
    insurancePolicyNumber: truck.insurancePolicyNumber,
    insuranceExpiresOn: truck.insuranceExpiresOn,
    serviceIntervalKm: truck.serviceIntervalKm,
    nextServiceDueKm: truck.nextServiceDueKm,
    status: truck.status,
    notes: truck.notes,
    createdById: truck.createdBy?.id ?? null,
    createdAt: truck.createdAt,
    updatedAt: truck.updatedAt,
  };
}

export function toTruckDeviceDto(device: TruckDevice) {
  return {
    id: device.id,
    identifier: device.identifier,
    serialNumber: device.serialNumber,
    enrolledAt: device.enrolledAt,
    lastSeenAt: device.lastSeenAt,
    enrolledById: device.enrolledBy?.id ?? null,
    currentTruckId: device.currentTruck?.id ?? null,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

export function toDeviceAssociationDto(association: DeviceTruckAssociation) {
  return {
    id: association.id,
    deviceId: association.device.id,
    truckId: association.truck.id,
    changedById: association.changedBy?.id ?? null,
    startedAt: association.startedAt,
    endedAt: association.endedAt,
    device: toTruckDeviceDto(association.device),
  };
}

export function toDriverDto(driver: DriverProfile) {
  return {
    id: driver.id,
    userId: driver.user.id,
    identifier: driver.identifier,
    phone: driver.phone,
    licenceNumber: driver.licenceNumber,
    licenceCode: driver.licenceCode,
    licenceCountry: driver.licenceCountry,
    licenceExpiresOn: driver.licenceExpiresOn,
    prdpNumber: driver.prdpNumber,
    prdpExpiresOn: driver.prdpExpiresOn,
    emergencyContactName: driver.emergencyContactName,
    emergencyContactPhone: driver.emergencyContactPhone,
    status: driver.status,
    currentTruckId: driver.currentTruck?.id ?? null,
    currentTruck: driver.currentTruck ? toTruckDto(driver.currentTruck) : null,
    notes: driver.notes,
    createdById: driver.createdBy?.id ?? null,
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt,
    user: {
      id: driver.user.id,
      firstName: driver.user.firstName,
      lastName: driver.user.lastName,
      email: driver.user.email,
      isActive: driver.user.isActive,
    },
  };
}

export function toDriverAssignmentDto(assignment: DriverTruckAssignment) {
  return {
    id: assignment.id,
    driverId: assignment.driver.id,
    truckId: assignment.truck.id,
    changedById: assignment.changedBy?.id ?? null,
    startedAt: assignment.startedAt,
    endedAt: assignment.endedAt,
    truck: toTruckDto(assignment.truck),
  };
}
