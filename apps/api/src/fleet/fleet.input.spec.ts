import { BadRequestException } from '@nestjs/common';
import { parseDriver, parseTruck, parseSearch } from './fleet.input.js';

export const validTruck = {
  identifier: ' VHH-012 ',
  registration: 'gp 24 vh gp',
  registrationCountry: 'za',
  make: 'Volvo',
  model: 'FH',
  category: 'tractor',
  fuelType: 'diesel',
  odometerKm: 125000,
  status: 'active',
};
export const validDriver = {
  userId: '12345678-1234-1234-1234-123456789abc',
  identifier: 'TM-014',
  phone: '+27 82 123 4567',
  licenceNumber: 'DL001',
  licenceCode: 'EC',
  licenceCountry: 'ZA',
  licenceExpiresOn: '2099-12-31',
  prdpNumber: 'PRDP001',
  prdpExpiresOn: '2099-12-31',
  status: 'active',
};

describe('Fleet input validation', () => {
  it('normalizes identifiers and records optional truck facts as null', () => {
    expect(parseTruck(validTruck)).toMatchObject({
      identifier: 'VHH-012',
      registration: 'GP 24 VH GP',
      registrationCountry: 'ZA',
      vin: null,
      year: null,
    });
  });
  it.each([
    { vin: 'short' },
    { vin: '1234567890123456I' },
    { year: 1800 },
    { odometerKm: -1 },
    { odometerKm: 1.5 },
    { odometerKm: '100' },
    { grossVehicleMassKg: 30000, tareKg: 20000, payloadCapacityKg: 15000 },
    { axleCount: 1 },
    { status: 'unknown' },
    { licenceDiscExpiresOn: '2027-02-30' },
    { licenceDiscExpiresOn: '2027-99-99' },
    { deviceSerialNumber: 'SERIAL' },
    { isActive: true },
  ])('rejects invalid truck facts %j', (patch) =>
    expect(() => parseTruck({ ...validTruck, ...patch })).toThrow(
      BadRequestException,
    ),
  );
  it('requires exactly one account source for a new driver and disallows changing it later', () => {
    expect(() => parseDriver(validDriver, true)).not.toThrow();
    expect(() => parseDriver({ ...validDriver, account: {} }, true)).toThrow(
      BadRequestException,
    );
    expect(() => parseDriver({ ...validDriver, userId: null }, true)).toThrow(
      BadRequestException,
    );
    expect(() => parseDriver(validDriver)).toThrow(BadRequestException);
  });
  it('retains incomplete eligibility as an unassigned profile but rejects assigning expired or incomplete credentials', () => {
    const { userId, ...profile } = validDriver;
    expect(() =>
      parseDriver({ ...profile, prdpNumber: null, prdpExpiresOn: null }),
    ).not.toThrow();
    for (const patch of [
      { licenceExpiresOn: '2000-01-01' },
      { prdpExpiresOn: '2000-01-01' },
      { prdpNumber: null, prdpExpiresOn: null },
      { status: 'inactive' },
    ])
      expect(() =>
        parseDriver({ ...profile, currentTruckId: userId, ...patch }),
      ).toThrow(BadRequestException);
  });
  it('validates paired contact and PrDP fields and rejects privilege injection', () => {
    expect(() =>
      parseDriver({ ...validDriver, prdpNumber: null }, true),
    ).toThrow(BadRequestException);
    expect(() =>
      parseDriver({ ...validDriver, emergencyContactName: 'Contact' }, true),
    ).toThrow(BadRequestException);
    expect(() => parseDriver({ ...validDriver, roleIds: [] }, true)).toThrow(
      BadRequestException,
    );
  });
  it.each([
    ['', '0'],
    ['', '1.5'],
    ['x'.repeat(201), '1'],
    ['', '1', 'invalid'],
  ])('rejects invalid search %j', (q, page, status?: string) =>
    expect(() => parseSearch(q, page, status)).toThrow(BadRequestException),
  );
});
