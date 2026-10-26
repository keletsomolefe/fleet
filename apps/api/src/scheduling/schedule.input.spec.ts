import { parseSchedule, date, parseMismatch } from './schedule.input.js';
const id = '11111111-1111-4111-8111-111111111111';
const base = {
  driverId: id,
  truckId: id,
  from: '2026-10-26',
  to: '2026-11-01',
  weekdays: [1, 2, 3, 4, 5],
};
describe('Driver scheduling input', () => {
  it('expands a week into only the selected days', () => {
    expect(parseSchedule(base).dates).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
  });
  it('supports leap-day month ranges and rejects normalized invalid dates', () => {
    expect(
      parseSchedule({
        ...base,
        from: '2028-02-01',
        to: '2028-02-29',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      }).dates,
    ).toHaveLength(29);
    for (const d of ['2027-02-29', '2026-04-31', '26-10-26', '2026-13-01'])
      expect(() => date(d)).toThrow();
  });
  it('requires an explicit conflict snapshot and note for overrides', () => {
    for (const v of [
      { override: true, note: 'reason' },
      { override: true, note: ' ', expectedConflicts: [id] },
      { weekdays: [] },
      { weekdays: [7] },
      { to: '2027-12-31' },
      { from: '2026-11-02' },
      { note: 1 },
    ])
      expect(() => parseSchedule({ ...base, ...v })).toThrow();
    expect(
      parseSchedule({
        ...base,
        override: true,
        note: ' Confirmed. ',
        expectedConflicts: [id],
      }).note,
    ).toBe('Confirmed.');
  });
  it('rejects takeover fields in driver reports', () => {
    expect(
      parseMismatch({
        expectedScheduleId: id,
        requestedTruckId: null,
        note: 'Wrong vehicle',
      }).requestedTruckId,
    ).toBeNull();
    expect(() =>
      parseMismatch({
        expectedScheduleId: id,
        requestedTruckId: id,
        note: 'Change',
        takeover: true,
      }),
    ).toThrow();
  });
});
