import { describe, expect, it } from 'vitest';
import type { ActivityData } from './activity.entity.js';
import {
  assertCanValidateRecord,
  computeDwellMinutes,
  evaluateActivityFlags,
} from './activity-rules.js';

const baseDelivery: ActivityData = {
  kind: 'delivery',
  occurredAt: '2026-11-25T10:00:00.000Z',
  arrivedAt: '2026-11-25T09:15:00.000Z',
  departedAt: '2026-11-25T10:00:00.000Z',
  dispatchId: null,
  runId: null,
  customer: { id: '11111111-1111-4111-8111-111111111111', name: 'Acme Mining' },
  product: { id: '22222222-2222-4222-8222-222222222222', name: 'Chrome Ore' },
  origin: { id: '33333333-3333-4333-8333-333333333333', name: 'North Pit' },
  destination: {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Port Terminal',
  },
  supplier: { id: null, name: '' },
  receiver: { id: null, name: '' },
  quantity: '33.0',
  unit: 'tonne',
  collectedQuantity: '34.0',
  grossWeight: null,
  tareWeight: null,
  waybillNumber: 'WB-1001',
  allocations: [],
  outcome: 'completed',
  transportCharge: true,
  fuelLitres: null,
  fuelTotalCost: null,
  fuelStation: '',
  expenseCategory: null,
  expenseAmount: null,
  vendorName: '',
  receiptNumber: '',
  odometerKm: '284650',
  note: '',
  latitude: -25.7479,
  longitude: 28.2293,
  accuracy: 12,
};

describe('Transport activity domain rules', () => {
  it('flags >2% weight variance between collected and delivered quantities', () => {
    const flags = evaluateActivityFlags({
      recordId: '55555555-5555-4555-8555-555555555555',
      data: baseDelivery,
      occurredAt: new Date(baseDelivery.occurredAt),
      sessionStartedAt: new Date('2026-11-25T06:00:00.000Z'),
      sessionEndedAt: null,
      hasCustomerProductLink: true,
      recordDriverId: 'd1',
      recordTruckId: 't1',
    });
    expect(flags).toContain('weight_variance_alert');
    expect(flags).toContain('unlinked_delivery');
    expect(() => assertCanValidateRecord(flags)).not.toThrow();
  });

  it('flags departure timestamps earlier than arrival without blocking validation', () => {
    const flags = evaluateActivityFlags({
      recordId: '55555555-5555-4555-8555-555555555555',
      data: {
        ...baseDelivery,
        arrivedAt: '2026-11-25T10:15:00.000Z',
        departedAt: '2026-11-25T10:00:00.000Z',
      },
      occurredAt: new Date(baseDelivery.occurredAt),
      sessionStartedAt: new Date('2026-11-25T06:00:00.000Z'),
      sessionEndedAt: null,
      hasCustomerProductLink: true,
      recordDriverId: 'd1',
      recordTruckId: 't1',
    });
    expect(flags).toContain('departure_before_arrival');
    expect(() => assertCanValidateRecord(flags)).not.toThrow();
  });

  it('blocks validation when catalogue references or load allocations are unresolved', () => {
    const flags = evaluateActivityFlags({
      recordId: '55555555-5555-4555-8555-555555555555',
      data: {
        ...baseDelivery,
        customer: { id: null, name: 'New Quarry' },
        waybillNumber: '',
      },
      occurredAt: new Date(baseDelivery.occurredAt),
      sessionStartedAt: new Date('2026-11-25T06:00:00.000Z'),
      sessionEndedAt: null,
      hasCustomerProductLink: false,
      recordDriverId: 'd1',
      recordTruckId: 't1',
    });
    expect(flags).toContain('unmatched_customer');
    expect(flags).toContain('missing_pod_number');
    expect(() => assertCanValidateRecord(flags)).toThrow(
      /Match the customer, product and sites/,
    );
  });

  it('flags missing fuel cost and missing road expense amount', () => {
    const fuelFlags = evaluateActivityFlags({
      recordId: '55555555-5555-4555-8555-555555555555',
      data: {
        ...baseDelivery,
        kind: 'fuel',
        fuelLitres: '450',
        fuelTotalCost: null,
      },
      occurredAt: new Date(baseDelivery.occurredAt),
      sessionStartedAt: new Date('2026-11-25T06:00:00.000Z'),
      sessionEndedAt: null,
      hasCustomerProductLink: false,
      recordDriverId: 'd1',
      recordTruckId: 't1',
    });
    expect(fuelFlags).toEqual(['missing_fuel_price']);

    const expenseFlags = evaluateActivityFlags({
      recordId: '55555555-5555-4555-8555-555555555555',
      data: {
        ...baseDelivery,
        kind: 'expense',
        expenseCategory: 'toll',
        expenseAmount: null,
      },
      occurredAt: new Date(baseDelivery.occurredAt),
      sessionStartedAt: new Date('2026-11-25T06:00:00.000Z'),
      sessionEndedAt: null,
      hasCustomerProductLink: false,
      recordDriverId: 'd1',
      recordTruckId: 't1',
    });
    expect(expenseFlags).toEqual(['missing_expense_amount']);
  });

  it('computes site dwell time in minutes and rejects negative intervals', () => {
    expect(
      computeDwellMinutes(
        '2026-11-25T09:15:00.000Z',
        '2026-11-25T10:00:00.000Z',
      ),
    ).toBe(45);
    expect(
      computeDwellMinutes(
        '2026-11-25T10:00:00.000Z',
        '2026-11-25T09:15:00.000Z',
      ),
    ).toBeNull();
  });
});
