export const units = {
  tonne: ['mass', 1000],
  kg: ['mass', 1],
  litre: ['volume', 1],
  m3: ['volume', 1000],
  pallet: ['pallet', 1],
  item: ['item', 1],
} as const;

export type Unit = keyof typeof units;

export const unitKeys = Object.keys(units) as Unit[];

const SCALE = 1_000_000n;

/** Parses a non-negative decimal string (up to 6 decimal places) into scaled BigInt. */
export function scaled(value: string): bigint {
  const trimmed = value.trim();
  const [whole, fraction = ''] = trimmed.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.slice(0, 6).padEnd(6, '0'));
}

/** Formats integer cents as a fixed 2-decimal ZAR string. */
export function money(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * Calculates a quantity-based transport charge using exact scaled integer arithmetic
 * with half-up rounding to cents. Supports compatible unit conversions
 * (`tonne <-> kg`, `litre <-> m3`) and returns `null` for incompatible dimensions.
 */
export function calculateCharge(
  quantity: string,
  source: Unit,
  price: string,
  target: Unit,
): string | null {
  if (units[source][0] !== units[target][0]) return null;
  const numerator =
    scaled(quantity) * scaled(price) * BigInt(units[source][1]) * 100n;
  const denominator = SCALE * SCALE * BigInt(units[target][1]);
  return money((numerator + denominator / 2n) / denominator);
}

/** Calculates a fixed per-delivery charge rounded half-up to cents. */
export function fixedCharge(price: string): string {
  return money((scaled(price) + 5000n) / 10_000n);
}

/**
 * Converts a mass quantity (`tonne` or `kg`) into metric tonnes (float) for operational
 * tonnage summaries; returns `0` for non-mass units.
 */
export function toTonnes(
  quantity: string | null | undefined,
  unit: Unit,
): number {
  if (!quantity) return 0;
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  if (unit === 'tonne') return parsed;
  if (unit === 'kg') return parsed / 1000;
  return 0;
}

/**
 * Computes percentage variance `(delivered - collected) / collected * 100` rounded
 * to 2 decimal places. Returns `null` when collected quantity is missing or zero.
 */
export function calculateVariancePercent(
  collected: string | null | undefined,
  delivered: string | null | undefined,
): number | null {
  if (!collected || !delivered) return null;
  const col = Number(collected);
  const del = Number(delivered);
  if (!Number.isFinite(col) || !Number.isFinite(del) || col <= 0) return null;
  return Math.round(((del - col) / col) * 10_000) / 100;
}
