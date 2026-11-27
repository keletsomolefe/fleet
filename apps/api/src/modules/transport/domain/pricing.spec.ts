import { describe, expect, it } from 'vitest';
import {
  calculateCharge,
  calculateVariancePercent,
  fixedCharge,
  money,
  scaled,
  toTonnes,
} from './pricing.js';

describe('Transport pricing domain calculations', () => {
  it('computes exact quantity charges with half-up cent rounding', () => {
    expect(calculateCharge('34.5', 'tonne', '185.50', 'tonne')).toBe('6399.75');
    expect(calculateCharge('1', 'tonne', '10.005', 'tonne')).toBe('10.01');
    expect(calculateCharge('333.333', 'kg', '300', 'tonne')).toBe('100.00');
  });

  it('converts compatible mass and volume units accurately', () => {
    expect(calculateCharge('25000', 'kg', '120', 'tonne')).toBe('3000.00');
    expect(calculateCharge('2.5', 'm3', '22.50', 'litre')).toBe('56250.00');
  });

  it('returns null for incompatible unit dimensions', () => {
    expect(calculateCharge('10', 'tonne', '100', 'pallet')).toBeNull();
    expect(calculateCharge('10', 'litre', '50', 'kg')).toBeNull();
  });

  it('rounds fixed delivery charges half-up to cents', () => {
    expect(fixedCharge('1500.005')).toBe('1500.01');
    expect(fixedCharge('1500.004')).toBe('1500.00');
  });

  it('supports scaled BigInt formatting including negative margins', () => {
    expect(scaled('12.345678')).toBe(12_345_678n);
    expect(money(-12505n)).toBe('-125.05');
  });

  it('converts mass to tonnes and computes shrinkage variance percentage', () => {
    expect(toTonnes('32.4', 'tonne')).toBe(32.4);
    expect(toTonnes('32400', 'kg')).toBe(32.4);
    expect(toTonnes('12', 'pallet')).toBe(0);
    expect(calculateVariancePercent('34.0', '33.15')).toBe(-2.5);
    expect(calculateVariancePercent('0', '10')).toBeNull();
  });
});
