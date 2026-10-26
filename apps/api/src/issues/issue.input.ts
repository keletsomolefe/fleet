import { BadRequestException } from '@nestjs/common';
import { drivingId } from '../mobile/driving.input.js';

function object(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw new BadRequestException('Check the issue details.');
  return raw as Record<string, unknown>;
}
function text(raw: unknown, max: number) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max)
    throw new BadRequestException(`Enter a note of up to ${max} characters.`);
  return raw.trim();
}
export function parseIssue(raw: unknown) {
  const v = object(raw, ['id', 'truckId', 'category', 'description']);
  if (
    typeof v.category !== 'string' ||
    !['vehicle', 'safety', 'other'].includes(v.category)
  )
    throw new BadRequestException('Choose an issue type.');
  return {
    id: drivingId(v.id),
    truckId: v.truckId === null ? null : drivingId(v.truckId),
    category: v.category as 'vehicle' | 'safety' | 'other',
    description: text(v.description, 2000),
  };
}
export function parseIssueResolution(raw: unknown) {
  return text(object(raw, ['note']).note, 1000);
}
