import {
  assertNativeRequest,
  extractBearerToken,
} from '../../../plugins/mobile-auth.plugin.js';
import { BadRequestError } from '../../../shared/errors.js';
import { isUuid } from '../../../shared/identifiers.js';
import { strictObject } from '../../../shared/validation.js';

export const nativeRequest = assertNativeRequest;
export const bearer = extractBearerToken;

export interface MobileLoginDto {
  identifier: string;
  password: string;
}

export interface DeviceEnrollmentDto {
  truckId: string;
  deviceIdentifier: string;
  deviceToken: string;
  expectedDeviceId: string | null;
  replaceExisting: boolean;
}

export function parseLogin(raw: unknown): MobileLoginDto {
  // Older development clients may send mode; it never selects or grants access.
  const v = strictObject(raw, ['identifier', 'password', 'mode']);
  if (
    typeof v.identifier !== 'string' ||
    !v.identifier.trim() ||
    v.identifier.length > 320 ||
    typeof v.password !== 'string' ||
    !v.password ||
    v.password.length > 128 ||
    (v.mode !== undefined &&
      (typeof v.mode !== 'string' || !['driver', 'setup'].includes(v.mode)))
  ) {
    throw new BadRequestError('Enter your sign-in details.');
  }
  return {
    identifier: v.identifier.trim(),
    password: v.password,
  };
}

export function parseEnrollment(raw: unknown): DeviceEnrollmentDto {
  const v = strictObject(raw, [
    'truckId',
    'deviceIdentifier',
    'deviceToken',
    'expectedDeviceId',
    'replaceExisting',
  ]);
  if (
    !isUuid(v.truckId) ||
    typeof v.deviceIdentifier !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(v.deviceIdentifier.trim()) ||
    typeof v.deviceToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.deviceToken) ||
    (v.expectedDeviceId !== null && !isUuid(v.expectedDeviceId)) ||
    typeof v.replaceExisting !== 'boolean'
  ) {
    throw new BadRequestError(
      'Select a truck and enter a valid device identifier.',
    );
  }
  return {
    truckId: v.truckId,
    deviceIdentifier: v.deviceIdentifier.trim().toUpperCase(),
    deviceToken: v.deviceToken,
    expectedDeviceId: v.expectedDeviceId,
    replaceExisting: v.replaceExisting,
  };
}

export function parseConfirmation(raw: unknown): string {
  const v = strictObject(raw, ['associationId']);
  if (!isUuid(v.associationId)) {
    throw new BadRequestError('Refresh the assigned truck and try again.');
  }
  return v.associationId;
}
