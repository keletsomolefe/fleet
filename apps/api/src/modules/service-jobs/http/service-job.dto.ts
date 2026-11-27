import { BadRequestError } from '../../../shared/errors.js';
import {
  booleanOrDefault,
  enumChoice,
  optionalFiniteNumber,
  optionalText,
  optionalTimestamp,
  requiredText,
  strictObject,
  uuidField,
} from '../../../shared/validation.js';
import {
  progressStages,
  serviceTypes,
  type ProgressStage,
  type ServiceType,
} from '../domain/service-job.entity.js';
import {
  providerServices,
  type ProviderService,
} from '../domain/service-provider.entity.js';

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

function jobObject(raw: unknown, keys: readonly string[]) {
  return strictObject(
    raw,
    keys,
    'Check the details and try again.',
    'Check the details and try again.',
  );
}

function jobRequiredText(
  v: Record<string, unknown>,
  key: string,
  max: number,
): string {
  return requiredText(v, key, max, {
    missingMessage: 'Enter the required details.',
    invalidMessage: `Check the details (maximum ${max} characters).`,
  });
}

function jobOptionalText(
  v: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  return optionalText(
    v,
    key,
    max,
    `Check the details (maximum ${max} characters).`,
  );
}

export function normalizeWhatsAppNumber(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new BadRequestError(
      'Enter the WhatsApp number with country code, for example +27821234567.',
    );
  }
  const compact = raw.replace(/[\s().-]/g, '');
  const value = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new BadRequestError(
      'Enter the WhatsApp number with country code, for example +27821234567.',
    );
  }
  return value.slice(1);
}

export function displayWhatsAppNumber(number: string): string {
  return `+${number}`;
}

export function parseProviderInput(raw: unknown) {
  const v = jobObject(raw, [
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
  if (!Array.isArray(v.services) || v.services.length === 0) {
    throw new BadRequestError('Choose at least one service.');
  }
  const services = [...new Set(v.services)];
  if (
    services.some(
      (service) =>
        typeof service !== 'string' ||
        !providerServices.includes(service as ProviderService),
    )
  ) {
    throw new BadRequestError('Choose valid services.');
  }
  const email = jobOptionalText(v, 'email', 320);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new BadRequestError('Enter a valid email address.');
  }
  return {
    companyName: jobRequiredText(v, 'companyName', 120),
    contactName: jobRequiredText(v, 'contactName', 80),
    whatsappNumber: normalizeWhatsAppNumber(v.whatsappNumber),
    phone: jobOptionalText(v, 'phone', 30),
    email,
    services: services as ProviderService[],
    coverageArea: jobOptionalText(v, 'coverageArea', 120),
    notes: jobOptionalText(v, 'notes', 1000),
    status: enumChoice(v.status, ['active', 'paused'] as const, 'status', {
      fallback: 'active',
    }),
    alertsEnabled: booleanOrDefault(v.alertsEnabled, true),
    consent: booleanOrDefault(v.consent, false),
  };
}

export function parseJobInput(raw: unknown) {
  const v = jobObject(raw, [
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
  const latitude = optionalFiniteNumber(
    v.latitude,
    -90,
    90,
    'Check the latitude.',
  );
  const longitude = optionalFiniteNumber(
    v.longitude,
    -180,
    180,
    'Check the longitude.',
  );
  const locationAccuracyM = optionalFiniteNumber(
    v.locationAccuracyM,
    0,
    100_000,
    'Check the location accuracy.',
  );
  const locationCapturedAt = optionalTimestamp(v.locationCapturedAt);
  const hasCoords = latitude !== null && longitude !== null;

  return {
    id: uuidField(v.id, 'request', false),
    issueId: uuidField(v.issueId, 'issue', false),
    truckId: uuidField(v.truckId, 'vehicle')!,
    serviceType: enumChoice(v.serviceType, serviceTypes, 'service type', {
      fallback: 'mechanical',
    }),
    title: jobOptionalText(v, 'title', 120),
    description: jobRequiredText(v, 'description', 2000),
    locationText: jobOptionalText(v, 'locationText', 300),
    latitude: hasCoords ? latitude : null,
    longitude: hasCoords ? longitude : null,
    locationAccuracyM: hasCoords ? locationAccuracyM : null,
    locationCapturedAt: hasCoords ? locationCapturedAt : null,
    urgency: enumChoice(v.urgency, ['urgent', 'normal'] as const, 'urgency', {
      fallback: 'urgent',
    }),
    notifyProviders: booleanOrDefault(v.notifyProviders, true),
  };
}

export function parseProgressInput(raw: unknown): { stage: ProgressStage } {
  const v = jobObject(raw, ['stage']);
  return {
    stage: enumChoice(v.stage, progressStages, 'progress'),
  };
}

export function parseCompletionInput(raw: unknown) {
  const v = jobObject(raw, ['name', 'note', 'costCents', 'currency']);
  const name = jobOptionalText(v, 'name', 80);
  const currency =
    v.currency === undefined || v.currency === null || v.currency === ''
      ? 'ZAR'
      : typeof v.currency === 'string'
        ? v.currency.trim().toUpperCase()
        : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestError('Check the currency.');
  }
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
      value > 100_000_000
    ) {
      throw new BadRequestError('Enter a valid amount.');
    }
    costCents = value;
  }
  return {
    name,
    note: jobRequiredText(v, 'note', 1000),
    costCents,
    currency,
  };
}

export function parseCloseInput(raw: unknown) {
  const v = jobObject(raw, ['note', 'resolveIssue']);
  return {
    note: jobRequiredText(v, 'note', 1000),
    resolveIssue: booleanOrDefault(v.resolveIssue, false),
  };
}

export function parseReopenInput(raw: unknown) {
  const v = jobObject(raw, ['reason', 'reopenIssue']);
  return {
    reason: jobRequiredText(v, 'reason', 1000),
    reopenIssue: booleanOrDefault(v.reopenIssue, false),
  };
}

export function parseCancelInput(raw: unknown) {
  const v = jobObject(raw, ['reason']);
  return { reason: jobRequiredText(v, 'reason', 1000) };
}

export function parseReassignInput(raw: unknown) {
  const v = jobObject(raw, ['providerId', 'reason']);
  return {
    providerId: uuidField(v.providerId, 'provider')!,
    reason: jobRequiredText(v, 'reason', 1000),
  };
}

export function parseNoteInput(raw: unknown) {
  const v = jobObject(raw, ['note']);
  return { note: jobRequiredText(v, 'note', 1000) };
}

export function parseProviderStatusInput(raw: unknown) {
  const v = jobObject(raw, ['status']);
  return {
    status: enumChoice(v.status, ['active', 'paused'] as const, 'status'),
  };
}

export function parseProviderConsentInput(raw: unknown) {
  const v = jobObject(raw, ['consent']);
  if (typeof v.consent !== 'boolean' || !v.consent) {
    throw new BadRequestError(
      'Confirm that the provider agreed to receive WhatsApp job alerts.',
    );
  }
  return { consent: true as const };
}

export function parseProviderNameInput(raw: unknown) {
  if (raw === undefined || raw === null) return { name: '' };
  const v = jobObject(raw, ['name']);
  return { name: jobOptionalText(v, 'name', 80) ?? '' };
}
