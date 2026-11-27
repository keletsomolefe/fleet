import { isCalendarDate } from './calendar-date.js';
import { BadRequestError } from './errors.js';
import { isUuid } from './identifiers.js';

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f)
    ) {
      return true;
    }
  }
  return false;
}

export function fieldLabel(key: string): string {
  return key.replace(/[A-Z]/g, (s) => ` ${s.toLowerCase()}`);
}

/**
 * Validates that `raw` is a plain object containing only whitelisted keys.
 * Rejects arrays, primitives, null, and unexpected properties.
 */
export function strictObject(
  raw: unknown,
  allowedKeys: readonly string[],
  invalidMessage = 'Enter the details.',
  unexpectedMessage = 'Unexpected fields.',
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestError(invalidMessage);
  }
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new BadRequestError(unexpectedMessage);
  }
  return value;
}

/** Validates a required trimmed string without control characters. */
export function requiredText(
  source: Record<string, unknown>,
  key: string,
  max: number,
  options?: { missingMessage?: string; invalidMessage?: string },
): string {
  const value = source[key];
  if (value === undefined || value === null || value === '') {
    throw new BadRequestError(
      options?.missingMessage ?? `Enter ${fieldLabel(key)}.`,
    );
  }
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    hasControlChars(value)
  ) {
    throw new BadRequestError(
      options?.invalidMessage ?? `Invalid ${fieldLabel(key)}.`,
    );
  }
  return value.trim();
}

/** Validates an optional trimmed string without control characters. */
export function optionalText(
  source: Record<string, unknown>,
  key: string,
  max: number,
  invalidMessage?: string,
): string | null {
  const value = source[key];
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    hasControlChars(value)
  ) {
    throw new BadRequestError(invalidMessage ?? `Invalid ${fieldLabel(key)}.`);
  }
  return value.trim();
}

/** Validates a required non-empty note/text value directly. */
export function requiredNote(
  raw: unknown,
  max: number,
  message = `Enter a note of up to ${max} characters.`,
): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max) {
    throw new BadRequestError(message);
  }
  return raw.trim();
}

/** Validates a bounded integer field. */
export function boundedInteger(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  required = false,
): number | null {
  const value = source[key];
  if (value === '' || value === null || value === undefined) {
    if (required) throw new BadRequestError(`Enter ${fieldLabel(key)}.`);
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new BadRequestError(
      `Enter ${fieldLabel(key)} between ${min} and ${max}.`,
    );
  }
  return value;
}

/** Validates an optional finite floating-point number within `[min, max]`. */
export function optionalFiniteNumber(
  raw: unknown,
  min: number,
  max: number,
  message: string,
): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max
  ) {
    throw new BadRequestError(message);
  }
  return raw;
}

/** Validates an enum string choice with optional fallback or nullability. */
export function enumChoice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  label: string,
  options?: { fallback?: T; optional?: false },
): T;
export function enumChoice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  label: string,
  options: { optional: true },
): T | null;
export function enumChoice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  label: string,
  options?: { fallback?: T; optional?: boolean },
): T | null {
  if (raw === undefined || raw === null || raw === '') {
    if (options?.fallback !== undefined) return options.fallback;
    if (options?.optional) return null;
    throw new BadRequestError(`Choose a ${label}.`);
  }
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw new BadRequestError(`Choose a valid ${label}.`);
  }
  return raw as T;
}

/** Validates a calendar date string (`YYYY-MM-DD`) within optional bounds. */
export function parseCalendarDateField(
  source: Record<string, unknown>,
  key: string,
  required = false,
): string | null {
  const value = required
    ? requiredText(source, key, 10)
    : optionalText(source, key, 10);
  if (
    value &&
    (!isCalendarDate(value) || value < '1900-01-01' || value > '2200-12-31')
  ) {
    throw new BadRequestError(`Enter a valid ${fieldLabel(key)}.`);
  }
  return value;
}

/** Validates an optional or required UUID field. */
export function uuidField(
  raw: unknown,
  label: string,
  required = true,
): string | null {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new BadRequestError(`Choose a ${label}.`);
    return null;
  }
  if (!isUuid(raw)) {
    throw new BadRequestError(`Choose a valid ${label}.`);
  }
  return raw;
}

/** Validates a phone number string (7-15 digits, optional leading `+`). */
export function phoneField(
  source: Record<string, unknown>,
  key: string,
  required = false,
): string | null {
  const value = required
    ? requiredText(source, key, 30)
    : optionalText(source, key, 30);
  if (value) {
    const digits = value.replace(/\D/g, '').length;
    if (!/^\+?[\d ()-]{7,30}$/.test(value) || digits < 7 || digits > 15) {
      throw new BadRequestError('Enter a valid phone number.');
    }
  }
  return value;
}

/** Parses an optional ISO-8601 timestamp into a `Date`. */
export function optionalTimestamp(
  raw: unknown,
  message = 'Check the location time.',
): Date | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw))) {
    throw new BadRequestError(message);
  }
  return new Date(raw);
}

/** Parses a boolean field with a fallback default. */
export function booleanOrDefault(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/** Escapes `%`, `_`, and `\` for PostgreSQL `ILIKE` queries. */
export function escapeLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * Reusable Fastify JSON Schema definitions (compiled by Fastify's built-in Ajv)
 * so route parameters are validated at the HTTP edge before handlers run.
 */
export const UUID_SCHEMA_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const uuidIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: UUID_SCHEMA_PATTERN },
  },
} as const;

export function uuidParamsSchema<const K extends readonly string[]>(keys: K) {
  const properties: Record<string, { type: 'string'; pattern: string }> = {};
  for (const key of keys) {
    properties[key] = { type: 'string', pattern: UUID_SCHEMA_PATTERN };
  }
  return {
    type: 'object',
    required: [...keys],
    properties,
  } as const;
}
