import { BadRequestException } from '@nestjs/common';
import { uuidPattern } from '../fleet/fleet.input.js';

function object(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !keys.includes(k))
  )
    throw new BadRequestException('Check the vehicle selection.');
  return raw as Record<string, unknown>;
}
export function drivingId(raw: unknown): string {
  if (typeof raw !== 'string' || !uuidPattern.test(raw))
    throw new BadRequestException('Refresh the vehicle list and try again.');
  return raw;
}
export function parseDrivingStart(raw: unknown) {
  const v = object(raw, [
    'id',
    'truckId',
    'expectedOwnSessionId',
    'expectedScheduleId',
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
  };
}
export function parseDrivingEnd(raw: unknown) {
  return drivingId(object(raw, ['sessionId']).sessionId);
}
export function parseDisputeResolution(raw: unknown) {
  const v = object(raw, ['expectedActiveSessionId', 'resolution', 'note']);
  if (
    !['keep_current', 'release_vehicle'].includes(String(v.resolution)) ||
    typeof v.note !== 'string' ||
    !v.note.trim() ||
    v.note.trim().length > 1000
  )
    throw new BadRequestException('Choose a resolution and enter a note.');
  return {
    expectedActiveSessionId:
      v.expectedActiveSessionId === null
        ? null
        : drivingId(v.expectedActiveSessionId),
    resolution: v.resolution as 'keep_current' | 'release_vehicle',
    note: v.note.trim(),
  };
}
