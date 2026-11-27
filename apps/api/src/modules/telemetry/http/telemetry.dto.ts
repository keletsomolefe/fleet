import { createHash } from 'node:crypto';
import { BadRequestError } from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import type { TrackingEventKind } from '../domain/tracking-event.entity.js';

export interface Sample {
  eventId: string;
  sequence: number;
  kind: TrackingEventKind;
  recordedAt: string;
  data: Record<string, unknown>;
}

export function uuid(value: unknown): string {
  return assertUuid(value, 'Invalid tracking identifier.');
}

export function instant(value: unknown): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) < 946_684_800_000 ||
    Date.parse(value) > Date.now() + 300_000
  ) {
    throw new BadRequestError('Invalid recording time.');
  }
  return new Date(value);
}

export function parseBatch(value: unknown) {
  const v = value as Record<string, unknown>;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (k) => !['batchId', 'streamId', 'events', 'end'].includes(k),
    ) ||
    !Array.isArray(v.events) ||
    v.events.length > 100 ||
    JSON.stringify(v).length > 131_072
  ) {
    throw new BadRequestError('Send at most 100 tracking records per batch.');
  }
  let end: { at: Date; finalSequence: number } | undefined;
  if (v.end !== undefined) {
    const e = v.end as Record<string, unknown>;
    if (
      !e ||
      typeof e !== 'object' ||
      Array.isArray(e) ||
      Object.keys(e).some((k) => !['at', 'finalSequence'].includes(k)) ||
      !Number.isInteger(e.finalSequence) ||
      Number(e.finalSequence) < 0 ||
      Number(e.finalSequence) > 2_147_483_647
    ) {
      throw new BadRequestError('Invalid tracking close record.');
    }
    end = { at: instant(e.at), finalSequence: Number(e.finalSequence) };
  }
  if (!v.events.length && !end) {
    throw new BadRequestError('No tracking records supplied.');
  }
  return {
    batchId: uuid(v.batchId),
    streamId: uuid(v.streamId),
    events: v.events as unknown[],
    end,
  };
}

export function parseSample(value: unknown): Sample {
  const v = value as Record<string, unknown>;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (k) => !['eventId', 'sequence', 'kind', 'recordedAt', 'data'].includes(k),
    ) ||
    !Number.isInteger(v.sequence) ||
    Number(v.sequence) < 1 ||
    Number(v.sequence) > 2_147_483_647 ||
    typeof v.kind !== 'string' ||
    !['location', 'status'].includes(v.kind) ||
    !v.data ||
    typeof v.data !== 'object' ||
    Array.isArray(v.data) ||
    JSON.stringify(v.data).length > 8192
  ) {
    throw new BadRequestError('Invalid tracking record.');
  }
  instant(v.recordedAt);
  uuid(v.eventId);
  if (v.kind === 'location') {
    const c = (v.data as { coords?: Record<string, unknown> }).coords;
    if (
      !c ||
      typeof c.latitude !== 'number' ||
      !Number.isFinite(c.latitude) ||
      Math.abs(c.latitude) > 90 ||
      typeof c.longitude !== 'number' ||
      !Number.isFinite(c.longitude) ||
      Math.abs(c.longitude) > 180
    ) {
      throw new BadRequestError('Invalid GPS coordinates.');
    }
    for (const k of [
      'accuracy',
      'altitude',
      'altitudeAccuracy',
      'heading',
      'speed',
    ]) {
      if (
        c[k] != null &&
        (typeof c[k] !== 'number' || !Number.isFinite(c[k]))
      ) {
        throw new BadRequestError('Invalid GPS measurement.');
      }
    }
  } else {
    const code = (v.data as Record<string, unknown>).code;
    if (typeof code !== 'string' || code.length > 80) {
      throw new BadRequestError('Invalid tracking status.');
    }
  }
  return v as unknown as Sample;
}

export function digest(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, canonical(x)]),
      );
    }
    return v;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function missingRanges(sequences: number[], final: number | null) {
  const gaps: Array<{ from: number; to: number }> = [];
  let next = 1;
  for (const n of sequences) {
    if (n > next) gaps.push({ from: next, to: n - 1 });
    next = n + 1;
  }
  if (final !== null && next <= final) gaps.push({ from: next, to: final });
  return gaps;
}
