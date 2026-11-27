import { BadRequestError } from '../../../shared/errors.js';
import type { ActivityData } from './activity.entity.js';
import type { DispatchPlan } from './dispatch.entity.js';
import { calculateVariancePercent, scaled, units } from './pricing.js';

/** Weight/quantity shrinkage or overage percentage threshold that triggers an office review flag. */
export const WEIGHT_VARIANCE_ALERT_THRESHOLD_PERCENT = 2;

export const blockingValidationFlags = new Set([
  'unmatched_customer',
  'unmatched_product',
  'unmatched_origin',
  'unmatched_destination',
  'unmatched_supplier',
  'unmatched_receiver',
  'load_allocation_mismatch',
  'missing_load_shares',
  'collection_allocation_conflict',
  'delivered_exceeds_collection',
  'missing_customer_product',
  'missing_change_reason',
]);

/** Ensures no blocking data-integrity flags remain before an office reviewer marks a record validated. */
export function assertCanValidateRecord(flags: readonly string[]): void {
  if (flags.some((flag) => blockingValidationFlags.has(flag))) {
    throw new BadRequestError(
      'Match the customer, product and sites, and check the load shares before validating.',
    );
  }
}

/** Computes turnaround/dwell duration in whole minutes between arrival and departure timestamps. */
export function computeDwellMinutes(
  arrivedAt: string | null | undefined,
  departedAt: string | null | undefined,
): number | null {
  if (!arrivedAt || !departedAt) return null;
  const start = Date.parse(arrivedAt);
  const end = Date.parse(departedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return Math.round((end - start) / 60_000);
}

export interface EvaluateActivityFlagsInput {
  recordId: string;
  data: ActivityData;
  occurredAt: Date;
  sessionStartedAt: Date;
  sessionEndedAt: Date | null;
  hasCustomerProductLink: boolean;
  dispatchPlan?: DispatchPlan | null;
  linkedCollection?: {
    id: string;
    driverId: string;
    truckId: string;
    data: ActivityData;
  } | null;
  recordDriverId: string;
  recordTruckId: string;
}

/** Pure domain flag evaluator for a collection, delivery, fuel, or road-expense record. */
export function evaluateActivityFlags(
  input: EvaluateActivityFlagsInput,
): string[] {
  const { data } = input;
  const flags = new Set<string>();

  if (
    input.occurredAt < input.sessionStartedAt ||
    (input.sessionEndedAt && input.occurredAt > input.sessionEndedAt)
  ) {
    flags.add('outside_confirmed_session');
  }

  if (data.kind === 'fuel') {
    if (!data.fuelLitres) flags.add('missing_fuel_litres');
    if (!data.fuelTotalCost) flags.add('missing_fuel_price');
    return [...flags];
  }

  if (data.kind === 'expense') {
    if (!data.expenseCategory) flags.add('missing_expense_category');
    if (!data.expenseAmount) flags.add('missing_expense_amount');
    return [...flags];
  }

  // Collection & Delivery operational rules
  if (!data.customer.id) flags.add('unmatched_customer');
  if (!data.product.id) flags.add('unmatched_product');
  if (!data.origin.id) flags.add('unmatched_origin');
  if (data.supplier.name && !data.supplier.id) flags.add('unmatched_supplier');

  if (data.kind === 'delivery') {
    if (!data.destination.id) flags.add('unmatched_destination');
    if (data.receiver.name && !data.receiver.id) {
      flags.add('unmatched_receiver');
    }
    if (
      data.transportCharge &&
      data.customer.id &&
      data.product.id &&
      !input.hasCustomerProductLink
    ) {
      flags.add('missing_customer_product');
    }
    if (
      (data.outcome === 'completed' || data.outcome === 'partial') &&
      !data.waybillNumber
    ) {
      flags.add('missing_pod_number');
    }
  }

  // Multi-stop collection allocation validation
  if (data.kind === 'collection' && data.allocations.length > 0) {
    if (!data.quantity) {
      flags.add('load_allocation_mismatch');
    } else {
      const sum = data.allocations.reduce(
        (acc, item) => acc + scaled(item.quantity),
        0n,
      );
      if (sum !== scaled(data.quantity)) {
        flags.add('load_allocation_mismatch');
      }
    }
  }

  // Linked collection <-> delivery consistency and weight variance check
  if (data.kind === 'delivery') {
    let effectiveCollected = data.collectedQuantity;
    let collectedUnit = data.unit;

    if (data.runId) {
      const col = input.linkedCollection;
      if (
        !col ||
        col.driverId !== input.recordDriverId ||
        col.truckId !== input.recordTruckId ||
        col.data.product.id !== data.product.id
      ) {
        flags.add('collection_allocation_conflict');
      } else {
        const share = col.data.allocations.find(
          (a) => a.deliveryId === input.recordId,
        );
        if (share) {
          effectiveCollected = share.quantity;
          collectedUnit = col.data.unit;
        } else if (col.data.allocations.length > 0) {
          flags.add('missing_load_shares');
        } else if (col.data.quantity && !effectiveCollected) {
          effectiveCollected = col.data.quantity;
          collectedUnit = col.data.unit;
        }
      }
    }

    if (
      effectiveCollected &&
      data.quantity &&
      units[collectedUnit][0] === units[data.unit][0]
    ) {
      const colBase =
        scaled(effectiveCollected) * BigInt(units[collectedUnit][1]);
      const delBase = scaled(data.quantity) * BigInt(units[data.unit][1]);
      if (delBase > colBase) {
        flags.add('delivered_exceeds_collection');
      }
      const variance = calculateVariancePercent(
        String(Number(colBase) / 1_000_000),
        String(Number(delBase) / 1_000_000),
      );
      if (
        variance !== null &&
        Math.abs(variance) > WEIGHT_VARIANCE_ALERT_THRESHOLD_PERCENT
      ) {
        flags.add('weight_variance_alert');
      }
    }
  }

  // Dispatch plan change reason check
  if (input.dispatchPlan) {
    const plan = input.dispatchPlan;
    let changed =
      plan.customer.id !== data.customer.id ||
      plan.product.id !== data.product.id ||
      plan.origin.id !== data.origin.id;
    if (data.kind === 'delivery') {
      const stop = plan.deliveries.find((d) => d.id === input.recordId);
      if (
        stop &&
        (stop.destination.id !== data.destination.id ||
          stop.quantity !== data.quantity)
      ) {
        changed = true;
      }
    } else if (data.kind === 'collection' && plan.quantity !== data.quantity) {
      changed = true;
    }
    if (changed && !data.note.trim()) {
      flags.add('missing_change_reason');
    }
  }

  return [...flags];
}
