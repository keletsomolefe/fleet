import { BadRequestError } from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import {
  booleanOrDefault,
  optionalText,
  requiredNote,
  strictObject,
  uuidField,
} from '../../../shared/validation.js';

export function drivingId(raw: unknown): string {
  return assertUuid(raw, 'Refresh the vehicle list and try again.');
}

function drivingObject(raw: unknown, keys: readonly string[]) {
  return strictObject(
    raw,
    keys,
    'Check the vehicle selection.',
    'Check the vehicle selection.',
  );
}

export function optionalOdometerKm(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new BadRequestError(
      'Enter a non-negative odometer reading in kilometres (up to one decimal place).',
    );
  }
  const value = String(raw).trim();
  if (!/^\d{1,9}(\.\d)?$/.test(value)) {
    throw new BadRequestError(
      'Enter a non-negative odometer reading in kilometres (up to one decimal place).',
    );
  }
  return value;
}

export interface StartDrivingDto {
  id: string;
  truckId: string;
  expectedOwnSessionId: string | null;
  expectedScheduleId: string | null;
  startOdometerKm: string | null;
  startOdometerMissingPhotoReason: string | null;
  hasStartPhoto: boolean;
  previousEndOdometerKm: string | null;
  previousEndOdometerMissingPhotoReason: string | null;
  previousEndOdometerLowerReason: string | null;
  hasPreviousEndPhoto: boolean;
}

export interface EndDrivingDto {
  sessionId: string;
  endOdometerKm: string | null;
  endOdometerMissingPhotoReason: string | null;
  endOdometerLowerReason: string | null;
  hasEndPhoto: boolean;
}

export interface ResolveOccupancyDisputeDto {
  expectedActiveSessionId: string | null;
  resolution: 'keep_current' | 'release_vehicle';
  note: string;
}

export interface ReviewShiftMileageDto {
  startOdometerKm?: string | null;
  endOdometerKm?: string | null;
  reason: string;
  clearMissingPhotoFlags: boolean;
}

export interface ShiftListFilterDto {
  from: string | null;
  to: string | null;
  truckId: string | null;
  driverId: string | null;
  flaggedOnly: boolean;
}

export function parseDrivingStart(raw: unknown): StartDrivingDto {
  const v = drivingObject(raw, [
    'id',
    'truckId',
    'expectedOwnSessionId',
    'expectedScheduleId',
    'startOdometerKm',
    'startOdometerMissingPhotoReason',
    'hasStartPhoto',
    'previousEndOdometerKm',
    'previousEndOdometerMissingPhotoReason',
    'previousEndOdometerLowerReason',
    'hasPreviousEndPhoto',
  ]);
  return {
    id: drivingId(v.id),
    expectedScheduleId:
      v.expectedScheduleId == null ? null : drivingId(v.expectedScheduleId),
    truckId: drivingId(v.truckId),
    expectedOwnSessionId:
      v.expectedOwnSessionId === null
        ? null
        : drivingId(v.expectedOwnSessionId),
    startOdometerKm: optionalOdometerKm(v.startOdometerKm),
    startOdometerMissingPhotoReason: optionalText(
      v,
      'startOdometerMissingPhotoReason',
      500,
    ),
    hasStartPhoto: booleanOrDefault(v.hasStartPhoto, false),
    previousEndOdometerKm: optionalOdometerKm(v.previousEndOdometerKm),
    previousEndOdometerMissingPhotoReason: optionalText(
      v,
      'previousEndOdometerMissingPhotoReason',
      500,
    ),
    previousEndOdometerLowerReason: optionalText(
      v,
      'previousEndOdometerLowerReason',
      500,
    ),
    hasPreviousEndPhoto: booleanOrDefault(v.hasPreviousEndPhoto, false),
  };
}

export function parseDrivingEnd(raw: unknown): string {
  return drivingId(drivingObject(raw, ['sessionId']).sessionId);
}

export function parseDrivingEndInput(raw: unknown): EndDrivingDto {
  const v = drivingObject(raw, [
    'sessionId',
    'endOdometerKm',
    'endOdometerMissingPhotoReason',
    'endOdometerLowerReason',
    'hasEndPhoto',
  ]);
  return {
    sessionId: drivingId(v.sessionId),
    endOdometerKm: optionalOdometerKm(v.endOdometerKm),
    endOdometerMissingPhotoReason: optionalText(
      v,
      'endOdometerMissingPhotoReason',
      500,
    ),
    endOdometerLowerReason: optionalText(v, 'endOdometerLowerReason', 500),
    hasEndPhoto: booleanOrDefault(v.hasEndPhoto, false),
  };
}

export function parseDisputeResolution(
  raw: unknown,
): ResolveOccupancyDisputeDto {
  const v = drivingObject(raw, [
    'expectedActiveSessionId',
    'resolution',
    'note',
  ]);
  if (
    typeof v.resolution !== 'string' ||
    !['keep_current', 'release_vehicle'].includes(v.resolution) ||
    typeof v.note !== 'string' ||
    !v.note.trim() ||
    v.note.trim().length > 1000
  ) {
    throw new BadRequestError('Choose a resolution and enter a note.');
  }
  return {
    expectedActiveSessionId:
      v.expectedActiveSessionId === null
        ? null
        : drivingId(v.expectedActiveSessionId),
    resolution: v.resolution as 'keep_current' | 'release_vehicle',
    note: v.note.trim(),
  };
}

export function parseShiftReview(raw: unknown): ReviewShiftMileageDto {
  const v = strictObject(
    raw,
    ['startOdometerKm', 'endOdometerKm', 'reason', 'clearMissingPhotoFlags'],
    'Enter review details.',
  );
  const result: ReviewShiftMileageDto = {
    reason: requiredNote(v.reason, 1000, 'Enter a reason for this review.'),
    clearMissingPhotoFlags: booleanOrDefault(v.clearMissingPhotoFlags, false),
  };
  if ('startOdometerKm' in v) {
    result.startOdometerKm = optionalOdometerKm(v.startOdometerKm);
  }
  if ('endOdometerKm' in v) {
    result.endOdometerKm = optionalOdometerKm(v.endOdometerKm);
  }
  return result;
}

export function parseShiftFilter(
  query: Record<string, string | undefined>,
): ShiftListFilterDto {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const from = query.from && datePattern.test(query.from) ? query.from : null;
  const to = query.to && datePattern.test(query.to) ? query.to : null;
  return {
    from,
    to,
    truckId: uuidField(query.truckId, 'vehicle', false),
    driverId: uuidField(query.driverId, 'driver', false),
    flaggedOnly: query.flagged === 'true',
  };
}
