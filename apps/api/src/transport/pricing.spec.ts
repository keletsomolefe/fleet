import { describe, expect, it } from 'vitest';
import { calculateCharge, fixedCharge } from './pricing.js';
import { activity, date, localDate } from './transport.input.js';
describe('transport pricing', () => {
  it('prices Eskom coal from actual tonnes or kilograms', () => {
    expect(calculateCharge('34', 'tonne', '250', 'tonne')).toBe('8500.00');
    expect(calculateCharge('34000', 'kg', '250', 'tonne')).toBe('8500.00');
    expect(calculateCharge('34.125', 'tonne', '250.123456', 'tonne')).toBe(
      '8535.46',
    );
  });
  it('uses exact decimal rounding and compatible volume units', () => {
    expect(calculateCharge('0.1', 'item', '0.05', 'item')).toBe('0.01');
    expect(calculateCharge('2000', 'litre', '30', 'm3')).toBe('60.00');
    expect(fixedCharge('123.455')).toBe('123.46');
  });
  it('never infers pallet weights, density or item counts', () => {
    expect(calculateCharge('34', 'tonne', '250', 'pallet')).toBeNull();
    expect(calculateCharge('34', 'litre', '250', 'kg')).toBeNull();
    expect(calculateCharge('34', 'pallet', '250', 'item')).toBeNull();
  });
  it('allows incomplete operational logs and typed references', () => {
    const a = activity({
      kind: 'delivery',
      occurredAt: new Date().toISOString(),
      customer: { name: 'New customer' },
      product: { name: 'Coal' },
      destination: { name: 'Gate 4' },
    });
    expect(a.customer).toEqual({ id: null, name: 'New customer' });
    expect(a.quantity).toBeNull();
    expect(() => activity({ ...a, quantity: '-2' })).toThrow();
    expect(() => activity({ ...a, price: '200' })).toThrow();
  });
  it('uses Johannesburg dates and rejects invalid dates', () => {
    expect(localDate('2026-09-30T22:30:00Z')).toBe('2026-10-01');
    expect(() => date('2026-02-30')).toThrow();
  });
});
