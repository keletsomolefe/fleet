import { createHash, timingSafeEqual } from 'node:crypto';
import { BadRequestError, UnauthorizedError } from './errors.js';

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

/** Validates a UUID string with a caller-supplied plain-language error message. */
export function assertUuid(
  value: unknown,
  message = 'Validation failed (uuid is expected)',
): string {
  if (!isUuid(value)) throw new BadRequestError(message);
  return value;
}

/** Constant-time string comparison for secrets, HMAC digests, and CSRF tokens. */
export function secretEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Validates and hashes a 64-hex-character device/stream upload token. */
export function hashDeviceToken(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new UnauthorizedError(
      'Location sharing access has ended. Start sharing again.',
    );
  }
  return createHash('sha256').update(token).digest('hex');
}
