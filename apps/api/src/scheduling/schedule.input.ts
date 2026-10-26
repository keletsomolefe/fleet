import { BadRequestException } from '@nestjs/common';
import { drivingId } from '../mobile/driving.input.js';
export function object(raw: unknown, keys: string[]) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !keys.includes(k))
  )
    throw new BadRequestException('Check the schedule details.');
  return raw as Record<string, unknown>;
}
export function date(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    !Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) ||
    new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw
  )
    throw new BadRequestException('Enter a valid date.');
  return raw;
}
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function note(raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 1000)
    throw new BadRequestException('Enter a note (up to 1000 characters).');
  return raw.trim();
}
export function parseSchedule(raw: unknown) {
  const v = object(raw, [
    'driverId',
    'truckId',
    'from',
    'to',
    'weekdays',
    'override',
    'note',
    'expectedConflicts',
  ]);
  const from = date(v.from),
    to = date(v.to);
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (span < 0 || span > 92)
    throw new BadRequestException('Choose a range of up to 93 days.');
  if (
    !Array.isArray(v.weekdays) ||
    !v.weekdays.length ||
    v.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw new BadRequestException('Choose the days of the week.');
  if (
    v.note !== undefined &&
    (typeof v.note !== 'string' || v.note.length > 1000)
  )
    throw new BadRequestException('Enter a note of up to 1000 characters.');
  if (v.override !== undefined && typeof v.override !== 'boolean')
    throw new BadRequestException('Check the override choice.');
  if (
    v.override &&
    (!Array.isArray(v.expectedConflicts) || v.expectedConflicts.length > 186)
  )
    throw new BadRequestException('Review the conflicting dates first.');
  const dates: string[] = [];
  for (let i = 0; i <= span; i++) {
    const d = new Date(Date.parse(from) + i * 86400000);
    if (v.weekdays.includes(d.getUTCDay()))
      dates.push(d.toISOString().slice(0, 10));
  }
  if (!dates.length)
    throw new BadRequestException('No selected weekdays fall in this range.');
  return {
    driverId: drivingId(v.driverId),
    truckId: drivingId(v.truckId),
    dates,
    override: v.override === true,
    note: v.override
      ? note(v.note)
      : typeof v.note === 'string' && v.note.length <= 1000
        ? v.note.trim()
        : '',
    expectedConflicts: Array.isArray(v.expectedConflicts)
      ? v.expectedConflicts.map(drivingId).sort()
      : [],
  };
}
export function parseMismatch(raw: unknown) {
  const v = object(raw, ['expectedScheduleId', 'requestedTruckId', 'note']);
  return {
    expectedScheduleId: drivingId(v.expectedScheduleId),
    requestedTruckId:
      v.requestedTruckId === null ? null : drivingId(v.requestedTruckId),
    note: note(v.note),
  };
}
