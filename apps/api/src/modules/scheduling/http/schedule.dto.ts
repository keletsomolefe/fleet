import {
  isCalendarDate,
  operationalToday,
} from '../../../shared/calendar-date.js';
import { BadRequestError } from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import { requiredNote, strictObject } from '../../../shared/validation.js';

export const today = operationalToday;

export function scheduleObject(raw: unknown, keys: readonly string[]) {
  return strictObject(
    raw,
    keys,
    'Check the schedule details.',
    'Check the schedule details.',
  );
}

export function scheduleDate(raw: unknown): string {
  if (typeof raw !== 'string' || !isCalendarDate(raw)) {
    throw new BadRequestError('Enter a valid date.');
  }
  return raw;
}

export function scheduleNote(raw: unknown): string {
  return requiredNote(raw, 1000, 'Enter a note (up to 1000 characters).');
}

function scheduleUuid(raw: unknown): string {
  return assertUuid(raw, 'Refresh the vehicle list and try again.');
}

export interface CreateScheduleDto {
  driverId: string;
  truckId: string;
  dates: string[];
  override: boolean;
  note: string;
  expectedConflicts: string[];
}

export interface ReportScheduleMismatchDto {
  expectedScheduleId: string;
  requestedTruckId: string | null;
  note: string;
}

export interface ResolveScheduleDisputeDto {
  resolution: 'keep_schedule' | 'change_schedule';
  note: string;
  expectedScheduleId: string | null;
  expectedActiveSessionId: string | null;
  expectedRequestedScheduleId: string | null;
}

export function parseSchedule(raw: unknown): CreateScheduleDto {
  const v = scheduleObject(raw, [
    'driverId',
    'truckId',
    'from',
    'to',
    'weekdays',
    'override',
    'note',
    'expectedConflicts',
  ]);
  const from = scheduleDate(v.from);
  const to = scheduleDate(v.to);
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (span < 0 || span > 92) {
    throw new BadRequestError('Choose a range of up to 93 days.');
  }
  if (
    !Array.isArray(v.weekdays) ||
    !v.weekdays.length ||
    v.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    throw new BadRequestError('Choose the days of the week.');
  }
  if (
    v.note !== undefined &&
    (typeof v.note !== 'string' || v.note.length > 1000)
  ) {
    throw new BadRequestError('Enter a note of up to 1000 characters.');
  }
  if (v.override !== undefined && typeof v.override !== 'boolean') {
    throw new BadRequestError('Check the override choice.');
  }
  if (
    v.override &&
    (!Array.isArray(v.expectedConflicts) || v.expectedConflicts.length > 186)
  ) {
    throw new BadRequestError('Review the conflicting dates first.');
  }
  const dates: string[] = [];
  for (let i = 0; i <= span; i += 1) {
    const d = new Date(Date.parse(from) + i * 86_400_000);
    if (v.weekdays.includes(d.getUTCDay())) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  if (!dates.length) {
    throw new BadRequestError('No selected weekdays fall in this range.');
  }
  return {
    driverId: scheduleUuid(v.driverId),
    truckId: scheduleUuid(v.truckId),
    dates,
    override: v.override === true,
    note: v.override
      ? scheduleNote(v.note)
      : typeof v.note === 'string' && v.note.length <= 1000
        ? v.note.trim()
        : '',
    expectedConflicts: Array.isArray(v.expectedConflicts)
      ? v.expectedConflicts.map(scheduleUuid).sort()
      : [],
  };
}

export function parseCancelSchedule(raw: unknown): { note: string } {
  const v = scheduleObject(raw, ['note']);
  return { note: scheduleNote(v.note) };
}

export function parseMismatch(raw: unknown): ReportScheduleMismatchDto {
  const v = scheduleObject(raw, [
    'expectedScheduleId',
    'requestedTruckId',
    'note',
  ]);
  return {
    expectedScheduleId: scheduleUuid(v.expectedScheduleId),
    requestedTruckId:
      v.requestedTruckId === null ? null : scheduleUuid(v.requestedTruckId),
    note: scheduleNote(v.note),
  };
}

export function parseScheduleResolution(
  raw: unknown,
): ResolveScheduleDisputeDto {
  const v = scheduleObject(raw, [
    'resolution',
    'note',
    'expectedScheduleId',
    'expectedActiveSessionId',
    'expectedRequestedScheduleId',
  ]);
  if (
    typeof v.resolution !== 'string' ||
    !['keep_schedule', 'change_schedule'].includes(v.resolution)
  ) {
    throw new BadRequestError('Choose a schedule resolution.');
  }
  return {
    resolution: v.resolution as 'keep_schedule' | 'change_schedule',
    note: scheduleNote(v.note),
    expectedScheduleId:
      v.expectedScheduleId === null
        ? null
        : scheduleUuid(v.expectedScheduleId),
    expectedActiveSessionId:
      v.expectedActiveSessionId === null
        ? null
        : scheduleUuid(v.expectedActiveSessionId),
    expectedRequestedScheduleId:
      v.expectedRequestedScheduleId === null
        ? null
        : scheduleUuid(v.expectedRequestedScheduleId),
  };
}
