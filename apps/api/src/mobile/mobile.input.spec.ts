import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  bearer,
  nativeRequest,
  parseConfirmation,
  parseEnrollment,
  parseLogin,
} from './mobile.input.js';
import { hashDeviceToken } from './mobile-device.service.js';

const id = '12345678-1234-4234-8234-123456789abc';
const enrollment = {
  truckId: id,
  deviceIdentifier: ' tab-01 ',
  deviceToken: 'a'.repeat(64),
  expectedDeviceId: null,
  replaceExisting: false,
};
describe('Native request boundaries', () => {
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name],
  });
  it.each(['origin', 'cookie', 'sec-fetch-site'])(
    'rejects browser %s on native endpoints',
    (key) => {
      expect(() => nativeRequest(headers({ [key]: 'present' }))).toThrow(
        ForbiddenException,
      );
    },
  );
  it('requires a bearer credential and never accepts a cookie as fallback', () => {
    expect(() => bearer(headers({}))).toThrow(UnauthorizedException);
    expect(() =>
      bearer(headers({ authorization: 'Bearer token\nwith-header-injection' })),
    ).toThrow(UnauthorizedException);
    expect(bearer(headers({ authorization: `Bearer ${'x'.repeat(32)}` }))).toBe(
      'x'.repeat(32),
    );
  });
  it('requires explicit expected-device and replacement state and rejects privilege injection', () => {
    expect(parseEnrollment(enrollment).deviceIdentifier).toBe('TAB-01');
    for (const patch of [
      { expectedDeviceId: undefined },
      { replaceExisting: 'true' },
      { truckId: 'bad' },
      { deviceToken: 'bad' },
      { deviceIdentifier: 'tab with spaces' },
      { roleIds: [id] },
    ])
      expect(() => parseEnrollment({ ...enrollment, ...patch })).toThrow(
        BadRequestException,
      );
  });
  it('validates login mode, credentials and current association', () => {
    expect(
      parseLogin({ identifier: ' TM-001 ', password: 'secret', mode: 'driver' })
        .identifier,
    ).toBe('TM-001');
    for (const patch of [
      { mode: 'owner' },
      { password: '' },
      { identifier: '' },
      { permissions: ['trucks.write'] },
    ])
      expect(() =>
        parseLogin({
          identifier: 'TM-001',
          password: 'secret',
          mode: 'driver',
          ...patch,
        }),
      ).toThrow(BadRequestException);
    expect(parseConfirmation({ associationId: id })).toBe(id);
    expect(() => parseConfirmation({ associationId: id, truckId: id })).toThrow(
      BadRequestException,
    );
  });
  it('stores a deterministic digest rather than the device credential', () => {
    expect(hashDeviceToken(enrollment.deviceToken)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDeviceToken(enrollment.deviceToken)).not.toBe(
      enrollment.deviceToken,
    );
    expect(() => hashDeviceToken('')).toThrow(UnauthorizedException);
  });
});
