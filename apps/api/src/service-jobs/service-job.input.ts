import { BadRequestError } from '../http/errors.js';
import { uuidPattern } from '../fleet/fleet.input.js';
import {
  progressStages,
  serviceTypes,
  type ProgressStage,
  type ServiceType,
} from './service-job.entity.js';
import {
  providerServices,
  type ProviderService,
} from './service-provider.entity.js';

export const serviceTypeLabels: Record<ServiceType, string> = {
  mechanical: 'Mechanical',
  tyres: 'Tyres',
  towing: 'Towing',
  electrical: 'Electrical',
  bodywork: 'Body damage',
  fuel: 'Fuel',
  accident: 'Accident',
  other: 'Other',
};
export const serviceTypeDescriptions: Record<ServiceType, string> = {
  mechanical: 'Engine, brakes, gearbox or another mechanical fault',
  tyres: 'Puncture, tyre damage or wheel problem',
  towing: 'Recovery or towing',
  electrical: 'Battery, wiring, lights or electrical fault',
  bodywork: 'Accident damage or body repair',
  fuel: 'Fuel delivery or fuel problem',
  accident: 'Accident or safety concern',
  other: 'Another service request',
};

function object(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw new BadRequestError('Check the details and try again.');
  return raw as Record<string, unknown>;
}
function text(
  v: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
): string | null {
  const value = v[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestError('Enter the required details.');
    return null;
  }
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new BadRequestError(`Check the details (maximum ${max} characters).`);
  return value.trim();
}
function uuid(raw: unknown, label: string, required = true): string | null {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new BadRequestError(`Choose a ${label}.`);
    return null;
  }
  if (typeof raw !== 'string' || !uuidPattern.test(raw))
    throw new BadRequestError(`Choose a valid ${label}.`);
  return raw;
}
function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}
function optionalNumber(
  raw: unknown,
  min: number,
  max: number,
  label: string,
): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max
  )
    throw new BadRequestError(`Check the ${label}.`);
  return raw;
}
function choice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  label: string,
  fallback?: T,
): T {
  if (raw === undefined || raw === null || raw === '') {
    if (fallback) return fallback;
    throw new BadRequestError(`Choose a ${label}.`);
  }
  if (typeof raw !== 'string' || !allowed.includes(raw as T))
    throw new BadRequestError(`Choose a valid ${label}.`);
  return raw as T;
}

export function normalizeWhatsAppNumber(raw: unknown): string {
  if (typeof raw !== 'string')
    throw new BadRequestError(
      'Enter the WhatsApp number with country code, for example +27821234567.',
    );
  const compact = raw.replace(/[\s().-]/g, '');
  const value = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(value))
    throw new BadRequestError(
      'Enter the WhatsApp number with country code, for example +27821234567.',
    );
  return value.slice(1);
}

export function displayWhatsAppNumber(number: string): string {
  return `+${number}`;
}

export function parseProviderInput(raw: unknown) {
  const v = object(raw, [
    'companyName',
    'contactName',
    'whatsappNumber',
    'phone',
    'email',
    'services',
    'coverageArea',
    'notes',
    'status',
    'alertsEnabled',
    'consent',
  ]);
  if (!Array.isArray(v.services) || v.services.length === 0)
    throw new BadRequestError('Choose at least one service.');
  const services = [...new Set(v.services)];
  if (
    services.some(
      (service) =>
        typeof service !== 'string' ||
        !providerServices.includes(service as ProviderService),
    )
  )
    throw new BadRequestError('Choose valid services.');
  const email = text(v, 'email', 320);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new BadRequestError('Enter a valid email address.');
  return {
    companyName: text(v, 'companyName', 120, true)!,
    contactName: text(v, 'contactName', 80, true)!,
    whatsappNumber: normalizeWhatsAppNumber(v.whatsappNumber),
    phone: text(v, 'phone', 30),
    email,
    services: services as ProviderService[],
    coverageArea: text(v, 'coverageArea', 120),
    notes: text(v, 'notes', 1000),
    status: choice(v.status, ['active', 'paused'] as const, 'status', 'active'),
    alertsEnabled: bool(v.alertsEnabled, true),
    consent: bool(v.consent, false),
  };
}

export function parseJobInput(raw: unknown) {
  const v = object(raw, [
    'id',
    'issueId',
    'truckId',
    'serviceType',
    'title',
    'description',
    'locationText',
    'latitude',
    'longitude',
    'locationAccuracyM',
    'locationCapturedAt',
    'urgency',
    'notifyProviders',
  ]);
  const latitude = optionalNumber(v.latitude, -90, 90, 'latitude');
  const longitude = optionalNumber(v.longitude, -180, 180, 'longitude');
  const locationAccuracyM = optionalNumber(
    v.locationAccuracyM,
    0,
    100000,
    'location accuracy',
  );
  let locationCapturedAt: Date | null = null;
  if (v.locationCapturedAt !== undefined && v.locationCapturedAt !== null) {
    if (
      typeof v.locationCapturedAt !== 'string' ||
      !Number.isFinite(Date.parse(v.locationCapturedAt))
    )
      throw new BadRequestError('Check the location time.');
    locationCapturedAt = new Date(v.locationCapturedAt);
  }
  return {
    id: uuid(v.id, 'request', false),
    issueId: uuid(v.issueId, 'issue', false),
    truckId: uuid(v.truckId, 'vehicle')!,
    serviceType: choice(
      v.serviceType,
      serviceTypes,
      'service type',
      'mechanical',
    ),
    title: text(v, 'title', 120),
    description: text(v, 'description', 2000, true)!,
    locationText: text(v, 'locationText', 300),
    latitude: latitude !== null && longitude !== null ? latitude : null,
    longitude: latitude !== null && longitude !== null ? longitude : null,
    locationAccuracyM:
      latitude !== null && longitude !== null ? locationAccuracyM : null,
    locationCapturedAt:
      latitude !== null && longitude !== null ? locationCapturedAt : null,
    urgency: choice(
      v.urgency,
      ['urgent', 'normal'] as const,
      'urgency',
      'urgent',
    ),
    notifyProviders: bool(v.notifyProviders, true),
  };
}

export function parseProgressInput(raw: unknown) {
  const v = object(raw, ['stage']);
  return {
    stage: choice(v.stage, progressStages, 'progress') as ProgressStage,
  };
}

export function parseCompletionInput(raw: unknown) {
  const v = object(raw, ['name', 'note', 'costCents', 'currency']);
  const name = text(v, 'name', 80);
  const currency =
    v.currency === undefined || v.currency === null || v.currency === ''
      ? 'ZAR'
      : String(v.currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new BadRequestError('Check the currency.');
  let costCents: number | null = null;
  if (v.costCents !== undefined && v.costCents !== null && v.costCents !== '') {
    const value =
      typeof v.costCents === 'string' && /^\d+$/.test(v.costCents)
        ? Number(v.costCents)
        : v.costCents;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100000000
    )
      throw new BadRequestError('Enter a valid amount.');
    costCents = value;
  }
  return {
    name,
    note: text(v, 'note', 1000, true)!,
    costCents,
    currency,
  };
}

export function parseCloseInput(raw: unknown) {
  const v = object(raw, ['note', 'resolveIssue']);
  return {
    note: text(v, 'note', 1000, true)!,
    resolveIssue: bool(v.resolveIssue, false),
  };
}
export function parseReopenInput(raw: unknown) {
  const v = object(raw, ['reason', 'reopenIssue']);
  return {
    reason: text(v, 'reason', 1000, true)!,
    reopenIssue: bool(v.reopenIssue, false),
  };
}
export function parseCancelInput(raw: unknown) {
  const v = object(raw, ['reason']);
  return { reason: text(v, 'reason', 1000, true)! };
}
export function parseReassignInput(raw: unknown) {
  const v = object(raw, ['providerId', 'reason']);
  return {
    providerId: uuid(v.providerId, 'provider')!,
    reason: text(v, 'reason', 1000, true)!,
  };
}
export function parseNoteInput(raw: unknown) {
  const v = object(raw, ['note']);
  return { note: text(v, 'note', 1000, true)! };
}
export function parseProviderStatusInput(raw: unknown) {
  const v = object(raw, ['status']);
  return {
    status: choice(v.status, ['active', 'paused'] as const, 'status'),
  };
}
export function parseProviderConsentInput(raw: unknown) {
  const v = object(raw, ['consent']);
  if (typeof v.consent !== 'boolean' || !v.consent)
    throw new BadRequestError(
      'Confirm that the provider agreed to receive WhatsApp job alerts.',
    );
  return { consent: true };
}

export function parseProviderNameInput(raw: unknown) {
  if (raw === undefined || raw === null) return { name: '' };
  const v = object(raw, ['name']);
  return { name: text(v, 'name', 80) ?? '' };
}
