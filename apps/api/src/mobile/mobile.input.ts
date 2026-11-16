import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from '../http/errors.js';
import { uuidPattern } from '../fleet/fleet.input.js';

import type { FastifyRequest } from 'fastify';
import { header } from '../http/request.js';

type NativeHeaders = Pick<FastifyRequest, 'headers'>;
export function nativeRequest(request: NativeHeaders) {
  // Native Kratos flows must never replace the browser's cookie/CSRF flow.
  if (
    header(request, 'origin') ||
    header(request, 'sec-fetch-site') ||
    header(request, 'cookie')
  )
    throw new ForbiddenError('Use the installed Fleet app.');
}
export function bearer(request: NativeHeaders) {
  nativeRequest(request);
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{16,1024})$/.exec(
    header(request, 'authorization') ?? '',
  );
  if (!match) throw new UnauthorizedError('Please sign in.');
  return match[1]!;
}
function object(raw: unknown, keys: string[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestError('Enter the details.');
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).some((k) => !keys.includes(k)))
    throw new BadRequestError('Unexpected fields.');
  return v;
}
export function parseLogin(raw: unknown) {
  // Older development clients may send mode; it never selects or grants access.
  const v = object(raw, ['identifier', 'password', 'mode']);
  if (
    typeof v.identifier !== 'string' ||
    !v.identifier.trim() ||
    v.identifier.length > 320 ||
    typeof v.password !== 'string' ||
    !v.password ||
    v.password.length > 128 ||
    (v.mode !== undefined && !['driver', 'setup'].includes(String(v.mode)))
  )
    throw new BadRequestError('Enter your sign-in details.');
  return {
    identifier: v.identifier.trim(),
    password: v.password,
  };
}
export function parseEnrollment(raw: unknown) {
  const v = object(raw, [
    'truckId',
    'deviceIdentifier',
    'deviceToken',
    'expectedDeviceId',
    'replaceExisting',
  ]);
  if (
    typeof v.truckId !== 'string' ||
    !uuidPattern.test(v.truckId) ||
    typeof v.deviceIdentifier !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(v.deviceIdentifier.trim()) ||
    typeof v.deviceToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.deviceToken) ||
    (v.expectedDeviceId !== null &&
      (typeof v.expectedDeviceId !== 'string' ||
        !uuidPattern.test(v.expectedDeviceId))) ||
    typeof v.replaceExisting !== 'boolean'
  )
    throw new BadRequestError(
      'Select a truck and enter a valid device identifier.',
    );
  return {
    truckId: v.truckId,
    deviceIdentifier: v.deviceIdentifier.trim().toUpperCase(),
    deviceToken: v.deviceToken,
    expectedDeviceId: v.expectedDeviceId as string | null,
    replaceExisting: v.replaceExisting,
  };
}
export function parseConfirmation(raw: unknown) {
  const v = object(raw, ['associationId']);
  if (typeof v.associationId !== 'string' || !uuidPattern.test(v.associationId))
    throw new BadRequestError('Refresh the assigned truck and try again.');
  return v.associationId;
}
