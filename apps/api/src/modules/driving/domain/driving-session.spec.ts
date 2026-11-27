import { describe, expect, it } from 'vitest';
import {
  computeShiftDistanceKm,
  evaluateShiftMileageFlags,
} from './driving-session.entity.js';

describe('Shift odometer and mileage domain rules', () => {
  it('computes positive shift distance and never returns negative km', () => {
    expect(computeShiftDistanceKm('284560', '284742')).toBe(182);
    expect(computeShiftDistanceKm('284560.5', '284600.0')).toBe(39.5);
    expect(computeShiftDistanceKm('284742', '284560')).toBeNull();
    expect(computeShiftDistanceKm('284560', null)).toBeNull();
  });

  it('flags missing photos, lower end readings, and readings below truck last odometer', () => {
    expect(
      evaluateShiftMileageFlags({
        startOdometerKm: '284500',
        hasStartPhoto: false,
        ended: false,
        endOdometerKm: null,
        hasEndPhoto: false,
        truckLastOdometerKm: 284560,
      }),
    ).toEqual(['missing_start_photo', 'odometer_below_truck_last']);

    expect(
      evaluateShiftMileageFlags({
        startOdometerKm: '284560',
        hasStartPhoto: true,
        ended: true,
        endOdometerKm: '284500',
        hasEndPhoto: true,
      }),
    ).toEqual(['lower_end_odometer']);

    expect(
      evaluateShiftMileageFlags({
        startOdometerKm: '284560',
        hasStartPhoto: true,
        ended: true,
        endOdometerKm: '284742',
        hasEndPhoto: true,
      }),
    ).toEqual([]);
  });
});
