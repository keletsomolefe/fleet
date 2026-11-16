import { BadRequestError } from '../http/errors.js';
import { drivingId } from '../mobile/driving.input.js';
import { serviceTypes, type ServiceType } from '../service-jobs/service-job.entity.js';

function object(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw new BadRequestError('Check the issue details.');
  return raw as Record<string, unknown>;
}
function text(raw: unknown, max: number) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max)
    throw new BadRequestError(`Enter a note of up to ${max} characters.`);
  return raw.trim();
}
function optionalNumber(
  raw: unknown,
  min: number,
  max: number,
): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max
  )
    throw new BadRequestError('Check the location details.');
  return raw;
}
export function parseIssue(raw: unknown) {
  const v = object(raw, [
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
    !['vehicle', 'safety', 'other'].includes(v.category)
  )
    throw new BadRequestError('Choose an issue type.');
  let serviceType: ServiceType | null = null;
  if (v.category === 'vehicle') {
    serviceType =
      v.serviceType === undefined || v.serviceType === null || v.serviceType === ''
        ? 'mechanical'
        : (v.serviceType as ServiceType);
    if (!serviceTypes.includes(serviceType))
      throw new BadRequestError('Choose a service type.');
  }
  const latitude = optionalNumber(v.latitude, -90, 90),
    longitude = optionalNumber(v.longitude, -180, 180),
    locationAccuracyM = optionalNumber(v.locationAccuracyM, 0, 100000);
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
    id: drivingId(v.id),
    truckId: v.truckId === null ? null : drivingId(v.truckId),
    category: v.category as 'vehicle' | 'safety' | 'other',
    description: text(v.description, 2000),
    serviceType,
    locationText:
      typeof v.locationText === 'string' && v.locationText.trim()
        ? text(v.locationText, 300)
        : null,
    latitude: latitude !== null && longitude !== null ? latitude : null,
    longitude: latitude !== null && longitude !== null ? longitude : null,
    locationAccuracyM:
      latitude !== null && longitude !== null ? locationAccuracyM : null,
    locationCapturedAt:
      latitude !== null && longitude !== null ? locationCapturedAt : null,
  };
}
export function parseIssueResolution(raw: unknown) {
  return text(object(raw, ['note']).note, 1000);
}
