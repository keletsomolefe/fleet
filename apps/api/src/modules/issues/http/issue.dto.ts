import { BadRequestError } from '../../../shared/errors.js';
import {
  optionalFiniteNumber,
  optionalTimestamp,
  requiredNote,
  strictObject,
} from '../../../shared/validation.js';
import { drivingId } from '../../driving/http/driving.dto.js';
import {
  serviceTypes,
  type ServiceType,
} from '../../service-jobs/domain/service-job.entity.js';
import {
  issueCategories,
  type IssueCategory,
} from '../domain/driver-issue.entity.js';

function issueObject(raw: unknown, keys: readonly string[]) {
  return strictObject(
    raw,
    keys,
    'Check the issue details.',
    'Check the issue details.',
  );
}

export interface ReportIssueDto {
  id: string;
  truckId: string | null;
  category: IssueCategory;
  description: string;
  serviceType: ServiceType | null;
  locationText: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracyM: number | null;
  locationCapturedAt: Date | null;
}

export function parseIssue(raw: unknown): ReportIssueDto {
  const v = issueObject(raw, [
    'id',
    'truckId',
    'category',
    'description',
    'serviceType',
    'locationText',
    'latitude',
    'longitude',
    'locationAccuracyM',
    'locationCapturedAt',
  ]);

  if (
    typeof v.category !== 'string' ||
    !issueCategories.includes(v.category as IssueCategory)
  ) {
    throw new BadRequestError('Choose an issue type.');
  }

  let serviceType: ServiceType | null = null;
  if (v.category === 'vehicle') {
    const candidate =
      v.serviceType === undefined ||
      v.serviceType === null ||
      v.serviceType === ''
        ? 'mechanical'
        : v.serviceType;
    if (
      typeof candidate !== 'string' ||
      !serviceTypes.includes(candidate as ServiceType)
    ) {
      throw new BadRequestError('Choose a service type.');
    }
    serviceType = candidate as ServiceType;
  }

  const latitude = optionalFiniteNumber(
    v.latitude,
    -90,
    90,
    'Check the location details.',
  );
  const longitude = optionalFiniteNumber(
    v.longitude,
    -180,
    180,
    'Check the location details.',
  );
  const locationAccuracyM = optionalFiniteNumber(
    v.locationAccuracyM,
    0,
    100_000,
    'Check the location details.',
  );
  const locationCapturedAt = optionalTimestamp(v.locationCapturedAt);
  const hasCoords = latitude !== null && longitude !== null;

  return {
    id: drivingId(v.id),
    truckId: v.truckId === null ? null : drivingId(v.truckId),
    category: v.category as IssueCategory,
    description: requiredNote(v.description, 2000),
    serviceType,
    locationText:
      typeof v.locationText === 'string' && v.locationText.trim()
        ? requiredNote(v.locationText, 300)
        : null,
    latitude: hasCoords ? latitude : null,
    longitude: hasCoords ? longitude : null,
    locationAccuracyM: hasCoords ? locationAccuracyM : null,
    locationCapturedAt: hasCoords ? locationCapturedAt : null,
  };
}

export function parseIssueResolution(raw: unknown): string {
  return requiredNote(issueObject(raw, ['note']).note, 1000);
}

export function parseRepairResolution(raw: unknown): string {
  const v = raw as { note?: unknown } | null;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => k !== 'note') ||
    typeof v.note !== 'string' ||
    !v.note.trim() ||
    v.note.trim().length > 1000
  ) {
    throw new BadRequestError(
      'Enter a repair comment of up to 1,000 characters.',
    );
  }
  return v.note.trim();
}
