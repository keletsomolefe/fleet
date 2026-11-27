/**
 * Fleet operational calendar dates always use South African operational time
 * (`Africa/Johannesburg`), including around UTC midnight.
 */
export const OPERATIONAL_TIME_ZONE = 'Africa/Johannesburg';

const calendarDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPERATIONAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Returns today's operational calendar date as `YYYY-MM-DD`. */
export function operationalToday(now: Date = new Date()): string {
  return calendarDateFormatter.format(now);
}

/** Checks that a string is a real Gregorian calendar date in `YYYY-MM-DD` format. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}
