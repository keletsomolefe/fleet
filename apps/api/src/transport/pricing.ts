import { units, type Unit } from './transport.input.js';
const scale = 1000000n;
export function scaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
}
export function money(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export function calculateCharge(
  quantity: string,
  source: Unit,
  price: string,
  target: Unit,
): string | null {
  if (units[source][0] !== units[target][0]) return null;
  const numerator =
    scaled(quantity) * scaled(price) * BigInt(units[source][1]) * 100n;
  const denominator = scale * scale * BigInt(units[target][1]);
  return money((numerator + denominator / 2n) / denominator);
}
export function fixedCharge(price: string): string {
  return money((scaled(price) + 5000n) / 10000n);
}
