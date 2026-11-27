import type { MikroORM } from '@mikro-orm/postgresql';
import { getEm, rawQuery } from '../../../database/context.js';
import { ForbiddenError } from '../../../shared/errors.js';
import { uuidField } from '../../../shared/validation.js';
import { computeShiftDistanceKm } from '../../driving/domain/driving-session.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { computeDwellMinutes } from '../domain/activity-rules.js';
import { calculateVariancePercent } from '../domain/pricing.js';
import { parseMonthString } from '../http/transport.dto.js';

function csvEscape(value: string | number | boolean | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface TruckMonthlySummary {
  truckId: string;
  truckName: string;
  registration: string;
  deliveries: number;
  tonnesDelivered: string;
  kmDriven: string;
  revenue: string;
  validated: string;
  awaitingReview: string;
  unpriced: number;
  fuelLitres: string;
  fuelSpend: string;
  avgFuelPricePerLitre: string | null;
  kmPerLitre: string | null;
  missingFuelPrices: number;
  repairSpend: string;
  serviceJobCount: number;
  otherExpenseSpend: string;
  totalSpend: string;
  estimatedNetMargin: string;
  revenuePerKm: string | null;
  costPerKm: string | null;
  lastRecordAt: string | null;
}

export class EarningsService {
  constructor(private readonly orm: MikroORM) {}

  async monthlyReport(
    context: AdminContext,
    rawMonth: string,
    rawTruckId?: string,
  ) {
    if (!context.permissions.includes('revenue.read')) {
      throw new ForbiddenError('Earnings access is required.');
    }
    const month = parseMonthString(rawMonth);
    const truckId = uuidField(rawTruckId, 'vehicle', false);
    const monthStart = `${month}-01`;
    const em = getEm(this.orm);

    // 1. Operational activity rows in the selected Africa/Johannesburg month
    const records = await rawQuery<{
      id: string;
      kind: string;
      occurredAt: string;
      truckId: string;
      truckName: string;
      registration: string;
      driverId: string;
      driverName: string;
      review: string;
      flags: string[];
      data: Record<string, unknown>;
      amount: string | null;
      pricingStatus: string | null;
      customerName: string | null;
      productName: string | null;
    }>(
      em,
      `SELECT r.id, r.kind, r."occurredAt", r."truckId",
              t.identifier AS "truckName", t.registration,
              r."driverId", concat(u."firstName", ' ', u."lastName") AS "driverName",
              r.review, r.flags, r.data,
              c.amount::text AS amount, c.status AS "pricingStatus",
              cu.name AS "customerName", p.name AS "productName"
       FROM app.transport_records r
       JOIN app.trucks t ON t.id = r."truckId"
       JOIN app.driver_profiles dp ON dp.id = r."driverId"
       JOIN app.users u ON u.id = dp."userId"
       LEFT JOIN app.transport_charges c ON c."recordId" = r.id
       LEFT JOIN app.customers cu ON cu.id = NULLIF(r.data->'customer'->>'id', '')::uuid
       LEFT JOIN app.products p ON p.id = NULLIF(r.data->'product'->>'id', '')::uuid
       WHERE r.review <> 'void'
         AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
         AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date + interval '1 month'
         AND ($2::uuid IS NULL OR r."truckId" = $2::uuid)
       ORDER BY r."occurredAt" ASC, r.id ASC`,
      [monthStart, truckId],
    );

    // 2. Per-truck aggregates combining transport_records, truck_expenses, service_jobs, and driving_sessions
    const truckMetaRows = await rawQuery<{
      truckId: string;
      truckName: string;
      registration: string;
    }>(
      em,
      `SELECT id AS "truckId", identifier AS "truckName", registration
       FROM app.trucks
       WHERE ($1::uuid IS NULL OR id = $1::uuid)
       ORDER BY identifier ASC`,
      [truckId],
    );

    const [
      recordAggs,
      officeExpenseAggs,
      serviceJobAggs,
      shiftDistanceAggs,
      byCustomer,
      byProduct,
      byExpenseCategory,
    ] = await Promise.all([
      rawQuery<{
        truckId: string;
        deliveries: number;
        tonnesDelivered: string;
        revenue: string;
        validated: string;
        awaitingReview: string;
        unpriced: number;
        fuelLitres: string;
        fuelSpend: string;
        missingFuelPrices: number;
        driverRepairSpend: string;
        driverOtherSpend: string;
        lastRecordAt: string | null;
      }>(
        em,
        `SELECT r."truckId",
                count(*) FILTER (WHERE r.kind = 'delivery' AND r.data->>'outcome' IN ('completed', 'partial'))::int AS deliveries,
                COALESCE(sum(
                  CASE
                    WHEN r.kind = 'delivery' AND r.data->>'outcome' IN ('completed', 'partial') AND r.data->>'quantity' IS NOT NULL
                      THEN CASE
                        WHEN r.data->>'unit' = 'tonne' THEN (r.data->>'quantity')::numeric
                        WHEN r.data->>'unit' = 'kg' THEN (r.data->>'quantity')::numeric / 1000
                        ELSE 0
                      END
                    ELSE 0
                  END
                ), 0)::text AS "tonnesDelivered",
                COALESCE(sum(c.amount) FILTER (WHERE c.status = 'priced'), 0)::text AS revenue,
                COALESCE(sum(c.amount) FILTER (WHERE c.status = 'priced' AND r.review = 'validated'), 0)::text AS validated,
                COALESCE(sum(c.amount) FILTER (WHERE c.status = 'priced' AND r.review <> 'validated'), 0)::text AS "awaitingReview",
                count(*) FILTER (WHERE c.status = 'needs_pricing')::int AS unpriced,
                COALESCE(sum((r.data->>'fuelLitres')::numeric) FILTER (WHERE r.kind = 'fuel'), 0)::text AS "fuelLitres",
                COALESCE(sum((r.data->>'fuelTotalCost')::numeric) FILTER (WHERE r.kind = 'fuel'), 0)::text AS "fuelSpend",
                count(*) FILTER (WHERE r.kind = 'fuel' AND r.data->>'fuelTotalCost' IS NULL)::int AS "missingFuelPrices",
                COALESCE(sum((r.data->>'expenseAmount')::numeric) FILTER (WHERE r.kind = 'expense' AND r.data->>'expenseCategory' IN ('repair', 'tyres')), 0)::text AS "driverRepairSpend",
                COALESCE(sum((r.data->>'expenseAmount')::numeric) FILTER (WHERE r.kind = 'expense' AND COALESCE(r.data->>'expenseCategory', 'other') NOT IN ('repair', 'tyres')), 0)::text AS "driverOtherSpend",
                max(r."updatedAt")::text AS "lastRecordAt"
         FROM app.transport_records r
         LEFT JOIN app.transport_charges c ON c."recordId" = r.id
         WHERE r.review <> 'void'
           AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
           AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date + interval '1 month'
           AND ($2::uuid IS NULL OR r."truckId" = $2::uuid)
         GROUP BY r."truckId"`,
        [monthStart, truckId],
      ),
      rawQuery<{
        truckId: string;
        officeFuelLitres: string;
        officeFuelSpend: string;
        officeRepairSpend: string;
        officeOtherSpend: string;
      }>(
        em,
        `SELECT e."truckId",
                COALESCE(sum(e.litres) FILTER (WHERE e.category = 'fuel'), 0)::text AS "officeFuelLitres",
                COALESCE(sum(e.amount) FILTER (WHERE e.category = 'fuel'), 0)::text AS "officeFuelSpend",
                COALESCE(sum(e.amount) FILTER (WHERE e.category IN ('repair', 'tyres', 'maintenance')), 0)::text AS "officeRepairSpend",
                COALESCE(sum(e.amount) FILTER (WHERE e.category NOT IN ('fuel', 'repair', 'tyres', 'maintenance')), 0)::text AS "officeOtherSpend"
         FROM app.truck_expenses e
         WHERE e."voidedAt" IS NULL
           AND e."occurredOn" >= $1::date
           AND e."occurredOn" < $1::date + interval '1 month'
           AND ($2::uuid IS NULL OR e."truckId" = $2::uuid)
         GROUP BY e."truckId"`,
        [monthStart, truckId],
      ),
      rawQuery<{
        truckId: string;
        serviceJobCount: number;
        serviceJobFuelSpend: string;
        serviceJobRepairSpend: string;
      }>(
        em,
        `SELECT j."truckId",
                count(*)::int AS "serviceJobCount",
                COALESCE(sum(j."completionCostCents") FILTER (WHERE j."serviceType" = 'fuel'), 0)::numeric / 100 AS "serviceJobFuelSpend",
                COALESCE(sum(j."completionCostCents") FILTER (WHERE j."serviceType" <> 'fuel'), 0)::numeric / 100 AS "serviceJobRepairSpend"
         FROM app.service_jobs j
         WHERE j.status IN ('completed', 'closed')
           AND j."completionCostCents" IS NOT NULL
           AND j."completionCostCents" > 0
           AND (COALESCE(j."completedAt", j."closedAt", j."createdAt") AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
           AND (COALESCE(j."completedAt", j."closedAt", j."createdAt") AT TIME ZONE 'Africa/Johannesburg')::date < $1::date + interval '1 month'
           AND ($2::uuid IS NULL OR j."truckId" = $2::uuid)
         GROUP BY j."truckId"`,
        [monthStart, truckId],
      ),
      rawQuery<{
        truckId: string;
        kmDriven: string;
      }>(
        em,
        `SELECT s."truckId",
                COALESCE(sum(s."endOdometerKm" - s."startOdometerKm"), 0)::text AS "kmDriven"
         FROM app.driving_sessions s
         WHERE s."confirmedDate" >= $1::date
           AND s."confirmedDate" < $1::date + interval '1 month'
           AND s."startOdometerKm" IS NOT NULL
           AND s."endOdometerKm" IS NOT NULL
           AND s."endOdometerKm" >= s."startOdometerKm"
           AND ($2::uuid IS NULL OR s."truckId" = $2::uuid)
         GROUP BY s."truckId"`,
        [monthStart, truckId],
      ),
      rawQuery<{
        truckId: string;
        name: string;
        deliveries: number;
        tonnes: string;
        amount: string;
        unpriced: number;
      }>(
        em,
        `SELECT r."truckId",
                COALESCE(NULLIF(r.data->'customer'->>'name', ''), 'Not recorded') AS name,
                count(*)::int AS deliveries,
                COALESCE(sum(
                  CASE
                    WHEN r.data->>'quantity' IS NOT NULL AND r.data->>'unit' = 'tonne' THEN (r.data->>'quantity')::numeric
                    WHEN r.data->>'quantity' IS NOT NULL AND r.data->>'unit' = 'kg' THEN (r.data->>'quantity')::numeric / 1000
                    ELSE 0
                  END
                ), 0)::text AS tonnes,
                COALESCE(sum(c.amount) FILTER (WHERE c.status = 'priced'), 0)::text AS amount,
                count(*) FILTER (WHERE c.status = 'needs_pricing')::int AS unpriced
         FROM app.transport_records r
         LEFT JOIN app.transport_charges c ON c."recordId" = r.id
         WHERE r.kind = 'delivery'
           AND r.review <> 'void'
           AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
           AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date + interval '1 month'
           AND ($2::uuid IS NULL OR r."truckId" = $2::uuid)
         GROUP BY r."truckId", r.data->'customer'->>'id', r.data->'customer'->>'name'
         ORDER BY name ASC`,
        [monthStart, truckId],
      ),
      rawQuery<{
        truckId: string;
        name: string;
        deliveries: number;
        tonnes: string;
        amount: string;
        unpriced: number;
      }>(
        em,
        `SELECT r."truckId",
                COALESCE(NULLIF(r.data->'product'->>'name', ''), 'Not recorded') AS name,
                count(*)::int AS deliveries,
                COALESCE(sum(
                  CASE
                    WHEN r.data->>'quantity' IS NOT NULL AND r.data->>'unit' = 'tonne' THEN (r.data->>'quantity')::numeric
                    WHEN r.data->>'quantity' IS NOT NULL AND r.data->>'unit' = 'kg' THEN (r.data->>'quantity')::numeric / 1000
                    ELSE 0
                  END
                ), 0)::text AS tonnes,
                COALESCE(sum(c.amount) FILTER (WHERE c.status = 'priced'), 0)::text AS amount,
                count(*) FILTER (WHERE c.status = 'needs_pricing')::int AS unpriced
         FROM app.transport_records r
         LEFT JOIN app.transport_charges c ON c."recordId" = r.id
         WHERE r.kind = 'delivery'
           AND r.review <> 'void'
           AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
           AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date + interval '1 month'
           AND ($2::uuid IS NULL OR r."truckId" = $2::uuid)
         GROUP BY r."truckId", r.data->'product'->>'id', r.data->'product'->>'name'
         ORDER BY name ASC`,
        [monthStart, truckId],
      ),
      rawQuery<{
        category: string;
        count: number;
        amount: string;
      }>(
        em,
        `WITH all_spend AS (
           SELECT CASE WHEN r.kind = 'fuel' THEN 'fuel' ELSE COALESCE(r.data->>'expenseCategory', 'other') END AS category,
                  CASE WHEN r.kind = 'fuel' THEN COALESCE((r.data->>'fuelTotalCost')::numeric, 0) ELSE COALESCE((r.data->>'expenseAmount')::numeric, 0) END AS amount
           FROM app.transport_records r
           WHERE r.kind IN ('fuel', 'expense')
             AND r.review <> 'void'
             AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
             AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $1::date + interval '1 month'
             AND ($2::uuid IS NULL OR r."truckId" = $2::uuid)
           UNION ALL
           SELECT e.category, e.amount
           FROM app.truck_expenses e
           WHERE e."voidedAt" IS NULL
             AND e."occurredOn" >= $1::date
             AND e."occurredOn" < $1::date + interval '1 month'
             AND ($2::uuid IS NULL OR e."truckId" = $2::uuid)
           UNION ALL
           SELECT CASE WHEN j."serviceType" = 'tyres' THEN 'tyres' WHEN j."serviceType" = 'fuel' THEN 'fuel' ELSE 'repair' END AS category,
                  j."completionCostCents"::numeric / 100 AS amount
           FROM app.service_jobs j
           WHERE j.status IN ('completed', 'closed')
             AND j."completionCostCents" IS NOT NULL
             AND j."completionCostCents" > 0
             AND (COALESCE(j."completedAt", j."closedAt", j."createdAt") AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date
             AND (COALESCE(j."completedAt", j."closedAt", j."createdAt") AT TIME ZONE 'Africa/Johannesburg')::date < $1::date + interval '1 month'
             AND ($2::uuid IS NULL OR j."truckId" = $2::uuid)
         )
         SELECT category, count(*)::int AS count, COALESCE(sum(amount), 0)::text AS amount
         FROM all_spend
         GROUP BY category
         ORDER BY sum(amount) DESC, category ASC`,
        [monthStart, truckId],
      ),
    ]);

    const recMap = new Map(recordAggs.map((r) => [r.truckId, r]));
    const offMap = new Map(officeExpenseAggs.map((r) => [r.truckId, r]));
    const jobMap = new Map(serviceJobAggs.map((r) => [r.truckId, r]));
    const kmMap = new Map(shiftDistanceAggs.map((r) => [r.truckId, r]));

    const totals: TruckMonthlySummary[] = [];
    for (const truck of truckMetaRows) {
      const rec = recMap.get(truck.truckId);
      const off = offMap.get(truck.truckId);
      const job = jobMap.get(truck.truckId);
      const kmRow = kmMap.get(truck.truckId);
      if (!rec && !off && !job && !kmRow && !truckId) continue;

      const revenue = Number(rec?.revenue ?? 0);
      const validated = Number(rec?.validated ?? 0);
      const awaitingReview = Number(rec?.awaitingReview ?? 0);
      const tonnesDelivered = Number(rec?.tonnesDelivered ?? 0);
      const kmDriven = Number(kmRow?.kmDriven ?? 0);

      const fuelLitres =
        Number(rec?.fuelLitres ?? 0) + Number(off?.officeFuelLitres ?? 0);
      const fuelSpend =
        Number(rec?.fuelSpend ?? 0) +
        Number(off?.officeFuelSpend ?? 0) +
        Number(job?.serviceJobFuelSpend ?? 0);
      const repairSpend =
        Number(rec?.driverRepairSpend ?? 0) +
        Number(off?.officeRepairSpend ?? 0) +
        Number(job?.serviceJobRepairSpend ?? 0);
      const otherExpenseSpend =
        Number(rec?.driverOtherSpend ?? 0) + Number(off?.officeOtherSpend ?? 0);
      const totalSpend = fuelSpend + repairSpend + otherExpenseSpend;
      const estimatedNetMargin = revenue - totalSpend;

      totals.push({
        truckId: truck.truckId,
        truckName: truck.truckName,
        registration: truck.registration,
        deliveries: rec?.deliveries ?? 0,
        tonnesDelivered: tonnesDelivered.toFixed(2),
        kmDriven: kmDriven.toFixed(1),
        revenue: revenue.toFixed(2),
        validated: validated.toFixed(2),
        awaitingReview: awaitingReview.toFixed(2),
        unpriced: rec?.unpriced ?? 0,
        fuelLitres: fuelLitres.toFixed(2),
        fuelSpend: fuelSpend.toFixed(2),
        avgFuelPricePerLitre:
          fuelLitres > 0 ? (fuelSpend / fuelLitres).toFixed(2) : null,
        kmPerLitre:
          fuelLitres > 0 && kmDriven > 0
            ? (kmDriven / fuelLitres).toFixed(2)
            : null,
        missingFuelPrices: rec?.missingFuelPrices ?? 0,
        repairSpend: repairSpend.toFixed(2),
        serviceJobCount: job?.serviceJobCount ?? 0,
        otherExpenseSpend: otherExpenseSpend.toFixed(2),
        totalSpend: totalSpend.toFixed(2),
        estimatedNetMargin: estimatedNetMargin.toFixed(2),
        revenuePerKm: kmDriven > 0 ? (revenue / kmDriven).toFixed(2) : null,
        costPerKm: kmDriven > 0 ? (totalSpend / kmDriven).toFixed(2) : null,
        lastRecordAt: rec?.lastRecordAt ?? null,
      });
    }

    const fleetSum = totals.reduce(
      (acc, row) => ({
        deliveries: acc.deliveries + row.deliveries,
        tonnesDelivered: acc.tonnesDelivered + Number(row.tonnesDelivered),
        kmDriven: acc.kmDriven + Number(row.kmDriven),
        revenue: acc.revenue + Number(row.revenue),
        validated: acc.validated + Number(row.validated),
        awaitingReview: acc.awaitingReview + Number(row.awaitingReview),
        unpriced: acc.unpriced + row.unpriced,
        fuelLitres: acc.fuelLitres + Number(row.fuelLitres),
        fuelSpend: acc.fuelSpend + Number(row.fuelSpend),
        repairSpend: acc.repairSpend + Number(row.repairSpend),
        serviceJobCount: acc.serviceJobCount + row.serviceJobCount,
        otherExpenseSpend: acc.otherExpenseSpend + Number(row.otherExpenseSpend),
        totalSpend: acc.totalSpend + Number(row.totalSpend),
      }),
      {
        deliveries: 0,
        tonnesDelivered: 0,
        kmDriven: 0,
        revenue: 0,
        validated: 0,
        awaitingReview: 0,
        unpriced: 0,
        fuelLitres: 0,
        fuelSpend: 0,
        repairSpend: 0,
        serviceJobCount: 0,
        otherExpenseSpend: 0,
        totalSpend: 0,
      },
    );

    return {
      month,
      currency: 'ZAR',
      generatedAt: new Date().toISOString(),
      summary: {
        deliveries: fleetSum.deliveries,
        tonnesDelivered: fleetSum.tonnesDelivered.toFixed(2),
        kmDriven: fleetSum.kmDriven.toFixed(1),
        revenue: fleetSum.revenue.toFixed(2),
        validated: fleetSum.validated.toFixed(2),
        awaitingReview: fleetSum.awaitingReview.toFixed(2),
        unpriced: fleetSum.unpriced,
        fuelLitres: fleetSum.fuelLitres.toFixed(2),
        fuelSpend: fleetSum.fuelSpend.toFixed(2),
        avgFuelPricePerLitre:
          fleetSum.fuelLitres > 0
            ? (fleetSum.fuelSpend / fleetSum.fuelLitres).toFixed(2)
            : null,
        repairSpend: fleetSum.repairSpend.toFixed(2),
        serviceJobCount: fleetSum.serviceJobCount,
        otherExpenseSpend: fleetSum.otherExpenseSpend.toFixed(2),
        totalSpend: fleetSum.totalSpend.toFixed(2),
        estimatedNetMargin: (fleetSum.revenue - fleetSum.totalSpend).toFixed(2),
      },
      totals,
      byCustomer,
      byProduct,
      byExpenseCategory,
      records,
    };
  }

  async exportMonthlyCsv(
    context: AdminContext,
    rawMonth: string,
    rawTruckId?: string,
  ): Promise<{ filename: string; csv: string }> {
    const report = await this.monthlyReport(context, rawMonth, rawTruckId);
    const lines: string[] = [
      [
        'Month',
        'Vehicle',
        'Registration',
        'Deliveries',
        'Tonnes Delivered',
        'KM Driven',
        'Estimated Revenue (ZAR)',
        'Validated Revenue (ZAR)',
        'Awaiting Review (ZAR)',
        'Unpriced Loads',
        'Fuel Litres',
        'Fuel Spend (ZAR)',
        'Repair Spend (ZAR)',
        'Other Spend (ZAR)',
        'Total Spend (ZAR)',
        'Estimated Net Margin (ZAR)',
        'Revenue/km (ZAR)',
        'Cost/km (ZAR)',
      ].join(','),
    ];

    for (const row of report.totals) {
      lines.push(
        [
          report.month,
          row.truckName,
          row.registration,
          row.deliveries,
          row.tonnesDelivered,
          row.kmDriven,
          row.revenue,
          row.validated,
          row.awaitingReview,
          row.unpriced,
          row.fuelLitres,
          row.fuelSpend,
          row.repairSpend,
          row.otherExpenseSpend,
          row.totalSpend,
          row.estimatedNetMargin,
          row.revenuePerKm ?? '',
          row.costPerKm ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }

    return {
      filename: `fleet-earnings-${report.month}.csv`,
      csv: `${lines.join('\r\n')}\r\n`,
    };
  }

  /**
   * Chronological end-to-end journey timeline showing everything drivers went through:
   * shift clock-ins/clock-outs (with start/end km), collections, deliveries (with variance,
   * dwell time, POD #, photos), fuel stops, road expenses, and breakdown service jobs.
   */
  async timeline(
    context: AdminContext,
    query: Record<string, string | undefined> = {},
  ) {
    if (
      !context.permissions.includes('activities.read') &&
      !context.permissions.includes('shifts.read')
    ) {
      throw new ForbiddenError('Driver activity access is required.');
    }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const from =
      query.from && datePattern.test(query.from) ? query.from : null;
    const to = query.to && datePattern.test(query.to) ? query.to : null;
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const driverId = uuidField(query.driverId, 'driver', false);
    const em = getEm(this.orm);

    const [sessions, records, jobs] = await Promise.all([
      rawQuery<{
        id: string;
        confirmedDate: string;
        startedAt: string;
        endedAt: string | null;
        endReason: string | null;
        truckId: string;
        registration: string;
        truckIdentifier: string;
        driverId: string;
        driverName: string;
        startOdometerKm: string | null;
        endOdometerKm: string | null;
        mileageFlags: string[];
        photoCount: number;
      }>(
        em,
        `SELECT s.id, s."confirmedDate"::text AS "confirmedDate", s."startedAt", s."endedAt", s."endReason",
                s."truckId", t.registration, t.identifier AS "truckIdentifier",
                s."driverId", concat(u."firstName", ' ', u."lastName") AS "driverName",
                s."startOdometerKm"::text AS "startOdometerKm",
                s."endOdometerKm"::text AS "endOdometerKm",
                s."mileageFlags",
                (SELECT count(*)::int FROM app.transport_attachments a WHERE a."drivingSessionId" = s.id) AS "photoCount"
         FROM app.driving_sessions s
         JOIN app.trucks t ON t.id = s."truckId"
         JOIN app.driver_profiles dp ON dp.id = s."driverId"
         JOIN app.users u ON u.id = dp."userId"
         WHERE ($1::date IS NULL OR s."confirmedDate" >= $1::date)
           AND ($2::date IS NULL OR s."confirmedDate" <= $2::date)
           AND ($3::uuid IS NULL OR s."truckId" = $3::uuid)
           AND ($4::uuid IS NULL OR s."driverId" = $4::uuid)
         ORDER BY s."startedAt" DESC
         LIMIT 100`,
        [from, to, truckId, driverId],
      ),
      rawQuery<{
        id: string;
        kind: string;
        occurredAt: string;
        truckId: string;
        registration: string;
        truckIdentifier: string;
        driverId: string;
        driverName: string;
        review: string;
        flags: string[];
        data: Record<string, unknown>;
        amount: string | null;
        pricingStatus: string | null;
        attachmentCount: number;
      }>(
        em,
        `SELECT r.id, r.kind, r."occurredAt", r."truckId",
                t.registration, t.identifier AS "truckIdentifier",
                r."driverId", concat(u."firstName", ' ', u."lastName") AS "driverName",
                r.review, r.flags, r.data,
                c.amount::text AS amount, c.status AS "pricingStatus",
                (SELECT count(*)::int FROM app.transport_attachments a WHERE a."recordId" = r.id) AS "attachmentCount"
         FROM app.transport_records r
         JOIN app.trucks t ON t.id = r."truckId"
         JOIN app.driver_profiles dp ON dp.id = r."driverId"
         JOIN app.users u ON u.id = dp."userId"
         LEFT JOIN app.transport_charges c ON c."recordId" = r.id
         WHERE ($1::date IS NULL OR (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date)
           AND ($2::date IS NULL OR (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date <= $2::date)
           AND ($3::uuid IS NULL OR r."truckId" = $3::uuid)
           AND ($4::uuid IS NULL OR r."driverId" = $4::uuid)
         ORDER BY r."occurredAt" DESC
         LIMIT 250`,
        [from, to, truckId, driverId],
      ),
      rawQuery<{
        id: string;
        reference: string;
        serviceType: string;
        title: string;
        status: string;
        createdAt: string;
        completionCostCents: number | null;
        truckId: string;
        registration: string;
        truckIdentifier: string;
        driverId: string | null;
        driverName: string | null;
      }>(
        em,
        `SELECT j.id, j.reference, j."serviceType", j.title, j.status, j."createdAt", j."completionCostCents",
                j."truckId", t.registration, t.identifier AS "truckIdentifier",
                j."driverId",
                CASE WHEN u.id IS NOT NULL THEN concat(u."firstName", ' ', u."lastName") ELSE NULL END AS "driverName"
         FROM app.service_jobs j
         JOIN app.trucks t ON t.id = j."truckId"
         LEFT JOIN app.driver_profiles dp ON dp.id = j."driverId"
         LEFT JOIN app.users u ON u.id = dp."userId"
         WHERE ($1::date IS NULL OR (j."createdAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $1::date)
           AND ($2::date IS NULL OR (j."createdAt" AT TIME ZONE 'Africa/Johannesburg')::date <= $2::date)
           AND ($3::uuid IS NULL OR j."truckId" = $3::uuid)
           AND ($4::uuid IS NULL OR j."driverId" = $4::uuid)
         ORDER BY j."createdAt" DESC
         LIMIT 100`,
        [from, to, truckId, driverId],
      ),
    ]);

    const showMoney = context.permissions.includes('revenue.read');

    const events = [
      ...sessions.flatMap((s) => {
        const items: Array<{
          id: string;
          eventType: 'shift_start' | 'shift_end';
          timestamp: string;
          sessionId: string;
          truckId: string;
          registration: string;
          truckIdentifier: string;
          driverId: string;
          driverName: string;
          summary: string;
          flags: string[];
          attachmentCount: number;
          details: Record<string, unknown>;
        }> = [
          {
            id: `shift-start:${s.id}`,
            eventType: 'shift_start',
            timestamp: new Date(s.startedAt).toISOString(),
            sessionId: s.id,
            truckId: s.truckId,
            registration: s.registration,
            truckIdentifier: s.truckIdentifier,
            driverId: s.driverId,
            driverName: s.driverName,
            summary:
              s.startOdometerKm != null
                ? `Started driving at ${s.startOdometerKm} km`
                : 'Started driving (no start km recorded)',
            flags: s.mileageFlags,
            attachmentCount: s.photoCount,
            details: {
              startOdometerKm: s.startOdometerKm,
              confirmedDate: s.confirmedDate,
            },
          },
        ];
        if (s.endedAt) {
          const dist = computeShiftDistanceKm(
            s.startOdometerKm,
            s.endOdometerKm,
          );
          items.push({
            id: `shift-end:${s.id}`,
            eventType: 'shift_end' as const,
            timestamp: new Date(s.endedAt).toISOString(),
            sessionId: s.id,
            truckId: s.truckId,
            registration: s.registration,
            truckIdentifier: s.truckIdentifier,
            driverId: s.driverId,
            driverName: s.driverName,
            summary:
              s.endOdometerKm != null
                ? `Finished driving at ${s.endOdometerKm} km${dist != null ? ` (${dist} km)` : ''}`
                : 'Finished driving',
            flags: s.mileageFlags,
            attachmentCount: s.photoCount,
            details: {
              startOdometerKm: s.startOdometerKm,
              endOdometerKm: s.endOdometerKm,
              distanceKm: dist,
              endReason: s.endReason,
            },
          });
        }
        return items;
      }),
      ...records.map((r) => {
        const d = r.data as Record<string, unknown>;
        const customerName =
          (d.customer as { name?: string } | undefined)?.name ?? '';
        const productName =
          (d.product as { name?: string } | undefined)?.name ?? '';
        const originName =
          (d.origin as { name?: string } | undefined)?.name ?? '';
        const destName =
          (d.destination as { name?: string } | undefined)?.name ?? '';
        const qty = typeof d.quantity === 'string' ? d.quantity : null;
        const unit = typeof d.unit === 'string' ? d.unit : 'tonne';
        const colQty =
          typeof d.collectedQuantity === 'string' ? d.collectedQuantity : null;
        const dwellMinutes = computeDwellMinutes(
          typeof d.arrivedAt === 'string' ? d.arrivedAt : null,
          typeof d.departedAt === 'string' ? d.departedAt : null,
        );
        const variancePercent =
          r.kind === 'delivery' ? calculateVariancePercent(colQty, qty) : null;

        let summary = '';
        if (r.kind === 'collection') {
          summary = `Collected ${qty ?? '?'} ${unit} ${productName || 'load'} at ${originName || 'site'}${customerName ? ` (${customerName})` : ''}`;
        } else if (r.kind === 'delivery') {
          summary = `Delivered ${qty ?? '?'} ${unit} ${productName || 'load'} to ${destName || 'site'}${customerName ? ` for ${customerName}` : ''}`;
        } else if (r.kind === 'fuel') {
          summary = `Fuel ${typeof d.fuelLitres === 'string' ? `${d.fuelLitres} L` : ''}${typeof d.fuelTotalCost === 'string' ? ` · R${d.fuelTotalCost}` : ''}${typeof d.fuelStation === 'string' && d.fuelStation ? ` at ${d.fuelStation}` : ''}`.trim();
        } else {
          summary = `Expense (${typeof d.expenseCategory === 'string' ? d.expenseCategory : 'other'})${typeof d.expenseAmount === 'string' ? ` · R${d.expenseAmount}` : ''}${typeof d.vendorName === 'string' && d.vendorName ? ` · ${d.vendorName}` : ''}`;
        }

        return {
          id: `record:${r.id}`,
          eventType: r.kind as 'collection' | 'delivery' | 'fuel' | 'expense',
          timestamp: new Date(r.occurredAt).toISOString(),
          recordId: r.id,
          truckId: r.truckId,
          registration: r.registration,
          truckIdentifier: r.truckIdentifier,
          driverId: r.driverId,
          driverName: r.driverName,
          review: r.review,
          summary,
          flags: r.flags,
          attachmentCount: r.attachmentCount,
          details: {
            customerName,
            productName,
            originName,
            destinationName: destName,
            quantity: qty,
            unit,
            waybillNumber:
              typeof d.waybillNumber === 'string' ? d.waybillNumber : '',
            receiptNumber:
              typeof d.receiptNumber === 'string' ? d.receiptNumber : '',
            odometerKm: typeof d.odometerKm === 'string' ? d.odometerKm : null,
            dwellMinutes,
            variancePercent,
            outcome: typeof d.outcome === 'string' ? d.outcome : null,
            note: typeof d.note === 'string' ? d.note : '',
            ...(showMoney
              ? { amount: r.amount, pricingStatus: r.pricingStatus }
              : {}),
          },
        };
      }),
      ...jobs.map((j) => ({
        id: `service-job:${j.id}`,
        eventType: 'service_job' as const,
        timestamp: new Date(j.createdAt).toISOString(),
        serviceJobId: j.id,
        truckId: j.truckId,
        registration: j.registration,
        truckIdentifier: j.truckIdentifier,
        driverId: j.driverId,
        driverName: j.driverName,
        summary: `Breakdown ${j.reference} (${j.serviceType}): ${j.title}`,
        flags: [],
        attachmentCount: 0,
        details: {
          reference: j.reference,
          status: j.status,
          serviceType: j.serviceType,
          ...(showMoney && j.completionCostCents != null
            ? { costZar: (j.completionCostCents / 100).toFixed(2) }
            : {}),
        },
      })),
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return { items: events };
  }
}
