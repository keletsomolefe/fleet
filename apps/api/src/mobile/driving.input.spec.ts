import { BadRequestException } from '@nestjs/common';
import { parseDrivingStart, parseDisputeResolution } from './driving.input.js';
const id = '11111111-1111-4111-8111-111111111111';
describe('Personal-phone vehicle request boundary', () => {
  it('requires an explicit previous-session snapshot and rejects client takeover grants', () => {
    expect(
      parseDrivingStart({ id, truckId: id, expectedOwnSessionId: null }),
    ).toEqual({
      id,
      truckId: id,
      expectedOwnSessionId: null,
      expectedScheduleId: null,
    });
    expect(() => parseDrivingStart({ id, truckId: id })).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseDrivingStart({
        id,
        truckId: id,
        expectedOwnSessionId: null,
        takeover: true,
      }),
    ).toThrow(BadRequestException);
  });
  it('requires a bounded note, recognized resolution and exact session snapshot', () => {
    expect(
      parseDisputeResolution({
        expectedActiveSessionId: null,
        resolution: 'release_vehicle',
        note: ' Confirmed parked. ',
      }).note,
    ).toBe('Confirmed parked.');
    for (const raw of [
      { expectedActiveSessionId: id, resolution: 'takeover', note: 'test' },
      { expectedActiveSessionId: id, resolution: 'release_vehicle', note: ' ' },
      { resolution: 'release_vehicle', note: 'test' },
      {
        expectedActiveSessionId: null,
        resolution: 'release_vehicle',
        note: 'x'.repeat(1001),
      },
    ])
      expect(() => parseDisputeResolution(raw)).toThrow(BadRequestException);
  });
});
