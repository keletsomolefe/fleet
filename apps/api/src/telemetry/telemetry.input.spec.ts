import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  digest,
  missingRanges,
  parseBatch,
  parseSample,
} from './telemetry.input.js';
describe('Location ingestion boundaries', () => {
  const sample = () => ({
    eventId: randomUUID(),
    sequence: 1,
    recordedAt: new Date().toISOString(),
    kind: 'location',
    data: {
      coords: {
        latitude: -26,
        longitude: 28,
        accuracy: 500,
        speed: 0,
        heading: -1,
        altitude: 1700,
      },
      mocked: true,
    },
  });
  it('preserves poor accuracy and mock fixes for analysis instead of silently filtering', () => {
    const value = sample();
    expect(parseSample(value)).toEqual(value);
  });
  it.each([
    { sequence: 0 },
    { kind: 'permission' },
    { recordedAt: 'bad' },
    { data: { coords: { latitude: 91, longitude: 0 } } },
    { data: { coords: { latitude: 0, longitude: 0, speed: Infinity } } },
  ])('rejects malformed records %j', (patch) => {
    expect(() => parseSample({ ...sample(), ...patch })).toThrow(
      BadRequestException,
    );
  });
  it('bounds batches and validates final sequence', () => {
    expect(() =>
      parseBatch({
        batchId: randomUUID(),
        streamId: randomUUID(),
        events: Array.from({ length: 101 }, sample),
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseBatch({
        batchId: randomUUID(),
        streamId: randomUUID(),
        events: [],
        end: { at: new Date().toISOString(), finalSequence: -1 },
      }),
    ).toThrow(BadRequestException);
  });
  it('hashes equivalent field order consistently and detects changed history', () => {
    expect(digest({ b: 1, a: { x: 2, y: 3 } })).toBe(
      digest({ a: { y: 3, x: 2 }, b: 1 }),
    );
    expect(digest(sample())).not.toBe(digest(sample()));
  });
  it('expresses sequence holes as bounded ranges without allocating missing records', () => {
    expect(missingRanges([1, 3, 8], 10)).toEqual([
      { from: 2, to: 2 },
      { from: 4, to: 7 },
      { from: 9, to: 10 },
    ]);
    expect(missingRanges([1000000000], null)).toEqual([
      { from: 1, to: 999999999 },
    ]);
  });
});
