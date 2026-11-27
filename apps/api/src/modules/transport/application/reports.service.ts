import type { FilterQuery, MikroORM } from '@mikro-orm/postgresql';
import { getEm, rawQuery } from '../../../database/context.js';
import { operationalToday } from '../../../shared/calendar-date.js';
import { BadRequestError, ForbiddenError } from '../../../shared/errors.js';
import { uuidField } from '../../../shared/validation.js';
import {
  computeShiftDistanceKm,
  DrivingSession,
} from '../../driving/domain/driving-session.entity.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { userFullName } from '../../identity/domain/user.entity.js';
import { computeDwellMinutes } from '../domain/activity-rules.js';
import {
  TransportAttachment,
  type ActivityData,
} from '../domain/activity.entity.js';
import { Customer, Product } from '../domain/catalogue.entity.js';
import { Dispatch, dispatchStatuses, type DispatchStatus } from '../domain/dispatch.entity.js';
import {
  truckExpenseCategories,
  type TruckExpenseCategory,
} from '../domain/expense.entity.js';
import { calculateVariancePercent } from '../domain/pricing.js';
import {
  buildCsvBuffer,
  buildExcelWorkbook,
  buildReportFilename,
  excelColumnLetter,
  formatSastDateTime,
  formatZarText,
  type KpiMetric,
  type ReportDataset,
  type ReportFormat,
  type SheetColumn,
  type TableSheetSpec,
} from '../domain/report-format.js';
import { parseMonthString } from '../http/transport.dto.js';
import type { EarningsService } from './earnings.service.js';
import type { ExpensesService, UnifiedExpenseRow } from './expenses.service.js';

const validDatasets: readonly ReportDataset[] = [
  'earnings',
  'activities',
  'expenses',
  'shifts',
  'dispatches',
];

const validFormats: readonly ReportFormat[] = ['xlsx', 'csv'];

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const activityKindLabel: Record<string, string> = {
  collection: 'Collection',
  delivery: 'Delivery',
  fuel: 'Fuel / Petrol',
  expense: 'Road Expense',
};

const reviewLabel: Record<string, string> = {
  pending: 'Pending review',
  validated: 'Validated',
  clarification: 'Needs clarification',
  void: 'Void',
};

const expenseSourceLabel: Record<string, string> = {
  office_expense: 'Office invoice',
  driver_fuel: 'Driver petrol / fuel',
  driver_expense: 'Driver road cost',
  service_job: 'Breakdown / service job',
};

const expenseCategoryLabel: Record<string, string> = {
  fuel: 'Fuel / Petrol',
  repair: 'Repairs',
  tyres: 'Tyres',
  tolls: 'Tolls',
  weighbridge: 'Weighbridge',
  permits: 'Permits & Fines',
  maintenance: 'Scheduled Service',
  insurance: 'Insurance',
  other: 'Other',
};

const flagLabel: Record<string, string> = {
  weight_variance: 'Weight variance (>2%)',
  missing_pod_photo: 'Missing POD photo',
  missing_receipt_photo: 'Missing receipt photo',
  missing_fuel_price: 'Missing fuel price',
  missing_rate: 'No transport rate',
  missing_start_odometer: 'Missing start km',
  missing_end_odometer: 'Missing end km',
  missing_start_photo: 'Missing start odometer photo',
  missing_end_photo: 'Missing end odometer photo',
  odometer_lower_than_previous: 'Odometer lower than previous',
  unusually_high_shift_km: 'High shift km (>1,800 km)',
  long_dwell: 'Long wait (>3h)',
  short_dwell: 'Short dwell',
  backdated: 'Backdated',
  duplicate_reference: 'Duplicate reference',
};

function parseDataset(raw: string | undefined): ReportDataset {
  if (raw && validDatasets.includes(raw as ReportDataset)) {
    return raw as ReportDataset;
  }
  throw new BadRequestError(
    `Choose a valid report dataset (${validDatasets.join(', ')}).`,
  );
}

function parseFormat(raw: string | undefined): ReportFormat {
  if (!raw) return 'xlsx';
  if (validFormats.includes(raw as ReportFormat)) {
    return raw as ReportFormat;
  }
  throw new BadRequestError('Choose a valid export format (xlsx or csv).');
}

function parseOptionalDate(raw: string | undefined): string | null {
  return raw && datePattern.test(raw) ? raw : null;
}

function formatFlags(flags: string[]): string {
  return flags.map((f) => flagLabel[f] ?? f).join('; ');
}

function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface ReportPreviewResult {
  dataset: ReportDataset;
  title: string;
  subtitle: string;
  generatedAt: string;
  currency: 'ZAR';
  activeFilters: Array<{ label: string; value: string }>;
  kpis: Array<{ label: string; value: string; hint?: string }>;
  totalRows: number;
  columns: Array<{ key: string; header: string; format?: string }>;
  rows: Array<Record<string, string | number | boolean | null>>;
  truncated: boolean;
}

interface PreparedReport {
  dataset: ReportDataset;
  title: string;
  subtitle: string;
  scopeTag: string;
  generatedAt: string;
  activeFilters: Array<{ label: string; value: string }>;
  kpis: KpiMetric[];
  primaryColumns: SheetColumn[];
  primaryRows: Array<Record<string, string | number | boolean | null | undefined>>;
  sheets: TableSheetSpec[];
}

export class ReportsService {
  constructor(
    private readonly orm: MikroORM,
    private readonly earnings: EarningsService,
    private readonly expenses: ExpensesService,
  ) {}

  private preparedBy(context: AdminContext): string {
    const full = `${context.user.firstName} ${context.user.lastName}`.trim();
    return full ? `${full} (${context.user.email})` : context.user.email;
  }

  private async resolveFilterNames(ids: {
    truckId?: string | null;
    driverId?: string | null;
    customerId?: string | null;
    productId?: string | null;
  }) {
    const em = getEm(this.orm);
    const [truck, driver, customer, product] = await Promise.all([
      ids.truckId ? em.findOne(Truck, { id: ids.truckId }) : Promise.resolve(null),
      ids.driverId
        ? em.findOne(DriverProfile, { id: ids.driverId }, { populate: ['user'] })
        : Promise.resolve(null),
      ids.customerId
        ? em.findOne(Customer, { id: ids.customerId })
        : Promise.resolve(null),
      ids.productId
        ? em.findOne(Product, { id: ids.productId })
        : Promise.resolve(null),
    ]);
    return {
      truck: truck ? `${truck.registration} (${truck.identifier})` : null,
      driver: driver ? userFullName(driver.user) : null,
      customer: customer ? customer.name : null,
      product: product ? product.name : null,
    };
  }

  private async prepareEarnings(
    context: AdminContext,
    query: Record<string, string | undefined>,
  ): Promise<PreparedReport> {
    const month = query.month?.trim()
      ? parseMonthString(query.month)
      : operationalToday().slice(0, 7);
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const [report, names] = await Promise.all([
      this.earnings.monthlyReport(context, month, truckId ?? undefined),
      this.resolveFilterNames({ truckId }),
    ]);

    const activeFilters: Array<{ label: string; value: string }> = [
      { label: 'Operational Month (SAST)', value: report.month },
    ];
    if (names.truck) activeFilters.push({ label: 'Vehicle', value: names.truck });

    const revNum = Number(report.summary.revenue);
    const spendNum = Number(report.summary.totalSpend);
    const marginNum = Number(report.summary.estimatedNetMargin);
    const marginPct = revNum > 0 ? marginNum / revNum : 0;

    const kpis: KpiMetric[] = [
      {
        label: 'Estimated Revenue',
        value: formatZarText(revNum),
        numericValue: revNum,
        format: 'currency',
        hint: `Validated: ${formatZarText(report.summary.validated)}`,
      },
      {
        label: 'Fuel / Petrol Spend',
        value: formatZarText(report.summary.fuelSpend),
        numericValue: Number(report.summary.fuelSpend),
        format: 'currency',
        hint: `${Number(report.summary.fuelLitres).toLocaleString('en-ZA')} L`,
      },
      {
        label: 'Repairs & Service',
        value: formatZarText(report.summary.repairSpend),
        numericValue: Number(report.summary.repairSpend),
        format: 'currency',
        hint: `${report.summary.serviceJobCount} breakdown job${report.summary.serviceJobCount === 1 ? '' : 's'}`,
      },
      {
        label: 'Other Spend',
        value: formatZarText(report.summary.otherExpenseSpend),
        numericValue: Number(report.summary.otherExpenseSpend),
        format: 'currency',
        hint: 'Tolls, permits, weighbridge',
      },
      {
        label: 'Estimated Net Margin',
        value: formatZarText(marginNum),
        numericValue: marginNum,
        format: 'currency',
        hint: revNum > 0 ? `${(marginPct * 100).toFixed(1)}% margin` : undefined,
      },
      {
        label: 'Deliveries',
        value: String(report.summary.deliveries),
        numericValue: report.summary.deliveries,
        format: 'integer',
        hint:
          report.summary.unpriced > 0
            ? `${report.summary.unpriced} unpriced`
            : 'All priced',
      },
      {
        label: 'Tonnes Delivered',
        value: `${Number(report.summary.tonnesDelivered).toLocaleString('en-ZA')} t`,
        numericValue: Number(report.summary.tonnesDelivered),
        format: 'decimal',
      },
      {
        label: 'Distance Driven',
        value: `${Number(report.summary.kmDriven).toLocaleString('en-ZA')} km`,
        numericValue: Number(report.summary.kmDriven),
        format: 'km',
      },
    ];

    const vehicleColumns: SheetColumn[] = [
      { key: 'month', header: 'Month', width: 12 },
      { key: 'registration', header: 'Registration', width: 16 },
      { key: 'truckName', header: 'Vehicle', width: 18 },
      { key: 'deliveries', header: 'Deliveries', format: 'integer', sum: true, width: 12 },
      { key: 'tonnesDelivered', header: 'Tonnes', format: 'decimal', sum: true, width: 13 },
      { key: 'kmDriven', header: 'KM Driven', format: 'km', sum: true, width: 13 },
      { key: 'revenue', header: 'Est. Revenue (ZAR)', format: 'currency', sum: true, width: 18 },
      { key: 'validated', header: 'Validated (ZAR)', format: 'currency', sum: true, width: 16 },
      { key: 'awaitingReview', header: 'Awaiting Review (ZAR)', format: 'currency', sum: true, width: 18 },
      { key: 'unpriced', header: 'Unpriced Loads', format: 'integer', sum: true, width: 14 },
      { key: 'fuelLitres', header: 'Fuel (L)', format: 'decimal', sum: true, width: 13 },
      { key: 'fuelSpend', header: 'Fuel Spend (ZAR)', format: 'currency', sum: true, width: 17 },
      { key: 'repairSpend', header: 'Repair Spend (ZAR)', format: 'currency', sum: true, width: 17 },
      { key: 'otherExpenseSpend', header: 'Other Spend (ZAR)', format: 'currency', sum: true, width: 17 },
      { key: 'totalSpend', header: 'Total Spend (ZAR)', format: 'currency', sum: true, width: 17 },
      { key: 'estimatedNetMargin', header: 'Est. Net Margin (ZAR)', format: 'currency', sum: true, width: 19 },
      { key: 'revenuePerKm', header: 'Revenue / km', format: 'currency', width: 15 },
      { key: 'costPerKm', header: 'Cost / km', format: 'currency', width: 14 },
      { key: 'kmPerLitre', header: 'km / L', format: 'decimal', width: 11 },
    ];

    const vehicleRows = report.totals.map((t) => ({
      month: report.month,
      registration: t.registration,
      truckName: t.truckName,
      deliveries: t.deliveries,
      tonnesDelivered: Number(t.tonnesDelivered),
      kmDriven: Number(t.kmDriven),
      revenue: Number(t.revenue),
      validated: Number(t.validated),
      awaitingReview: Number(t.awaitingReview),
      unpriced: t.unpriced,
      fuelLitres: Number(t.fuelLitres),
      fuelSpend: Number(t.fuelSpend),
      repairSpend: Number(t.repairSpend),
      otherExpenseSpend: Number(t.otherExpenseSpend),
      totalSpend: Number(t.totalSpend),
      estimatedNetMargin: Number(t.estimatedNetMargin),
      revenuePerKm: toNum(t.revenuePerKm),
      costPerKm: toNum(t.costPerKm),
      kmPerLitre: toNum(t.kmPerLitre),
    }));

    // Customer breakdown rolled up across vehicles
    const custMap = new Map<
      string,
      { name: string; deliveries: number; tonnes: number; amount: number; unpriced: number }
    >();
    for (const c of report.byCustomer) {
      const cur = custMap.get(c.name) ?? {
        name: c.name,
        deliveries: 0,
        tonnes: 0,
        amount: 0,
        unpriced: 0,
      };
      cur.deliveries += c.deliveries;
      cur.tonnes += Number(c.tonnes);
      cur.amount += Number(c.amount);
      cur.unpriced += c.unpriced;
      custMap.set(c.name, cur);
    }
    const customerRows = [...custMap.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({
        ...c,
        share: revNum > 0 ? c.amount / revNum : 0,
      }));

    // Product breakdown rolled up across vehicles
    const prodMap = new Map<
      string,
      { name: string; deliveries: number; tonnes: number; amount: number; unpriced: number }
    >();
    for (const p of report.byProduct) {
      const cur = prodMap.get(p.name) ?? {
        name: p.name,
        deliveries: 0,
        tonnes: 0,
        amount: 0,
        unpriced: 0,
      };
      cur.deliveries += p.deliveries;
      cur.tonnes += Number(p.tonnes);
      cur.amount += Number(p.amount);
      cur.unpriced += p.unpriced;
      prodMap.set(p.name, cur);
    }
    const productRows = [...prodMap.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((p) => ({
        ...p,
        share: revNum > 0 ? p.amount / revNum : 0,
      }));

    const categoryRows = report.byExpenseCategory.map((c) => {
      const amt = Number(c.amount);
      return {
        category: expenseCategoryLabel[c.category] ?? c.category,
        count: c.count,
        amount: amt,
        share: spendNum > 0 ? amt / spendNum : 0,
      };
    });

    const recordColumns: SheetColumn[] = [
      { key: 'occurredAt', header: 'Date & Time (SAST)', width: 18 },
      { key: 'registration', header: 'Registration', width: 15 },
      { key: 'truckName', header: 'Vehicle', width: 16 },
      { key: 'driverName', header: 'Driver', width: 20 },
      { key: 'kind', header: 'Activity Type', width: 15 },
      { key: 'review', header: 'Review Status', width: 17 },
      { key: 'customer', header: 'Customer', width: 22 },
      { key: 'product', header: 'Product', width: 20 },
      { key: 'origin', header: 'Collection Site', width: 22 },
      { key: 'destination', header: 'Delivery Site', width: 22 },
      { key: 'quantity', header: 'Quantity', format: 'decimal', sum: true, width: 12 },
      { key: 'unit', header: 'Unit', width: 10 },
      { key: 'reference', header: 'Waybill / Ref', width: 16 },
      { key: 'cost', header: 'Fuel / Road Cost (ZAR)', format: 'currency', sum: true, width: 19 },
      { key: 'revenue', header: 'Est. Revenue (ZAR)', format: 'currency', sum: true, width: 18 },
      { key: 'flags', header: 'Exceptions / Flags', width: 28, wrap: true },
    ];

    const recordRows = report.records.map((r) => {
      const d = r.data as Record<string, unknown>;
      const customer =
        r.customerName ?? (d.customer as { name?: string } | undefined)?.name ?? '';
      const product =
        r.productName ?? (d.product as { name?: string } | undefined)?.name ?? '';
      const origin = (d.origin as { name?: string } | undefined)?.name ?? '';
      const destination =
        (d.destination as { name?: string } | undefined)?.name ?? '';
      const cost =
        r.kind === 'fuel'
          ? toNum(d.fuelTotalCost as string | undefined)
          : r.kind === 'expense'
            ? toNum(d.expenseAmount as string | undefined)
            : null;
      return {
        occurredAt: formatSastDateTime(r.occurredAt),
        registration: r.registration,
        truckName: r.truckName,
        driverName: r.driverName,
        kind: activityKindLabel[r.kind] ?? r.kind,
        review: reviewLabel[r.review] ?? r.review,
        customer,
        product,
        origin,
        destination,
        quantity: toNum(d.quantity as string | undefined),
        unit: typeof d.unit === 'string' ? d.unit : '',
        reference:
          (typeof d.waybillNumber === 'string' && d.waybillNumber) ||
          (typeof d.receiptNumber === 'string' && d.receiptNumber) ||
          '',
        cost,
        revenue: r.pricingStatus === 'priced' ? toNum(r.amount) : null,
        flags: formatFlags(r.flags),
      };
    });

    const totalSpendCol = excelColumnLetter(15); // O
    const fuelSpendCol = excelColumnLetter(12); // L
    const otherSpendCol = excelColumnLetter(14); // N
    const revenueCol = excelColumnLetter(7); // G

    const sheets: TableSheetSpec[] = [
      {
        name: 'Executive Summary',
        metadata: {
          title: `Monthly Truck Earnings & P&L — ${report.month}`,
          subtitle:
            'Estimated transport revenue, fuel, repairs, road expenses and net operating margin by vehicle.',
          generatedAt: report.generatedAt,
          preparedBy: this.preparedBy(context),
          filters: activeFilters,
          currency: 'ZAR',
        },
        kpis,
        sectionTitle: 'Per-Vehicle Financial & Operational Performance',
        columns: vehicleColumns,
        rows: vehicleRows,
        cellFormula: (_rIdx, excelRowNum, colKey) => {
          if (colKey === 'totalSpend') {
            return `SUM(${fuelSpendCol}${excelRowNum}:${otherSpendCol}${excelRowNum})`;
          }
          if (colKey === 'estimatedNetMargin') {
            return `${revenueCol}${excelRowNum}-${totalSpendCol}${excelRowNum}`;
          }
          return null;
        },
        showTotals: true,
        totalsLabel: `Fleet Total (${vehicleRows.length} vehicle${vehicleRows.length === 1 ? '' : 's'})`,
      },
      {
        name: 'By Customer',
        sectionTitle: `Revenue Breakdown by Customer — ${report.month}`,
        columns: [
          { key: 'name', header: 'Customer', width: 28 },
          { key: 'deliveries', header: 'Deliveries', format: 'integer', sum: true, width: 13 },
          { key: 'tonnes', header: 'Tonnes', format: 'decimal', sum: true, width: 14 },
          { key: 'amount', header: 'Est. Revenue (ZAR)', format: 'currency', sum: true, width: 20 },
          { key: 'share', header: '% of Revenue', format: 'percent', width: 14 },
          { key: 'unpriced', header: 'Unpriced Loads', format: 'integer', sum: true, width: 15 },
        ],
        rows: customerRows,
        showTotals: true,
        totalsLabel: `Total (${customerRows.length} customers)`,
      },
      {
        name: 'By Product',
        sectionTitle: `Revenue Breakdown by Product — ${report.month}`,
        columns: [
          { key: 'name', header: 'Product', width: 28 },
          { key: 'deliveries', header: 'Deliveries', format: 'integer', sum: true, width: 13 },
          { key: 'tonnes', header: 'Tonnes', format: 'decimal', sum: true, width: 14 },
          { key: 'amount', header: 'Est. Revenue (ZAR)', format: 'currency', sum: true, width: 20 },
          { key: 'share', header: '% of Revenue', format: 'percent', width: 14 },
          { key: 'unpriced', header: 'Unpriced Loads', format: 'integer', sum: true, width: 15 },
        ],
        rows: productRows,
        showTotals: true,
        totalsLabel: `Total (${productRows.length} products)`,
      },
      {
        name: 'Spend by Category',
        sectionTitle: `Operating Spend by Category — ${report.month}`,
        columns: [
          { key: 'category', header: 'Expense Category', width: 24 },
          { key: 'count', header: 'Entries', format: 'integer', sum: true, width: 12 },
          { key: 'amount', header: 'Total Spend (ZAR)', format: 'currency', sum: true, width: 20 },
          { key: 'share', header: '% of Spend', format: 'percent', width: 14 },
        ],
        rows: categoryRows,
        showTotals: true,
        totalsLabel: `Total Spend`,
      },
      {
        name: 'Underlying Records',
        sectionTitle: `Underlying Operational Records — ${report.month}`,
        columns: recordColumns,
        rows: recordRows,
        showTotals: true,
        totalsLabel: `Total (${recordRows.length} records)`,
      },
    ];

    return {
      dataset: 'earnings',
      title: `Monthly Truck Earnings & P&L (${report.month})`,
      subtitle: 'Vehicle P&L, customer & product revenue, spend breakdown, and underlying records.',
      scopeTag: `${report.month}${names.truck ? `-${names.truck.split(' ')[0]}` : ''}`,
      generatedAt: report.generatedAt,
      activeFilters,
      kpis,
      primaryColumns: vehicleColumns,
      primaryRows: vehicleRows,
      sheets,
    };
  }

  private async prepareActivities(
    context: AdminContext,
    query: Record<string, string | undefined>,
  ): Promise<PreparedReport> {
    if (!context.permissions.includes('activities.read')) {
      throw new ForbiddenError('Activity access is required.');
    }
    const em = getEm(this.orm);
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const driverId = uuidField(query.driverId, 'driver', false);
    const customerId = uuidField(query.customerId, 'customer', false);
    const productId = uuidField(query.productId, 'product', false);
    const kind =
      query.kind && ['collection', 'delivery', 'fuel', 'expense'].includes(query.kind)
        ? query.kind
        : null;
    const review =
      query.review && ['pending', 'validated', 'clarification', 'void'].includes(query.review)
        ? query.review
        : null;
    const from = parseOptionalDate(query.from);
    const to = parseOptionalDate(query.to);
    const flaggedOnly = query.flagged === 'true';
    const showMoney = context.permissions.includes('revenue.read');

    const [rows, names] = await Promise.all([
      rawQuery<{
        id: string;
        kind: string;
        occurredAt: string;
        data: ActivityData;
        review: string;
        flags: string[];
        registration: string;
        truckIdentifier: string;
        driverName: string;
        amount: string | null;
        pricingStatus: string | null;
        attachmentCount: number;
      }>(
        em,
        `SELECT r.id, r.kind, r."occurredAt", r.data, r.review, r.flags,
                t.registration, t.identifier AS "truckIdentifier",
                concat(u."firstName", ' ', u."lastName") AS "driverName",
                c.amount::text AS amount, c.status AS "pricingStatus",
                (SELECT count(*)::int FROM app.transport_attachments a WHERE a."recordId" = r.id) AS "attachmentCount"
         FROM app.transport_records r
         JOIN app.trucks t ON t.id = r."truckId"
         JOIN app.driver_profiles dp ON dp.id = r."driverId"
         JOIN app.users u ON u.id = dp."userId"
         LEFT JOIN app.transport_charges c ON c."recordId" = r.id
         WHERE ($1::uuid IS NULL OR r."truckId" = $1::uuid)
           AND ($2::uuid IS NULL OR r."driverId" = $2::uuid)
           AND ($3::text IS NULL OR r.kind = $3::text)
           AND ($4::text IS NULL OR r.review = $4::text)
           AND ($5::date IS NULL OR (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $5::date)
           AND ($6::date IS NULL OR (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date <= $6::date)
           AND (NOT $7::boolean OR cardinality(r.flags) > 0)
           AND ($8::uuid IS NULL OR NULLIF(r.data->'customer'->>'id', '')::uuid = $8::uuid)
           AND ($9::uuid IS NULL OR NULLIF(r.data->'product'->>'id', '')::uuid = $9::uuid)
         ORDER BY r."occurredAt" DESC, r.id DESC
         LIMIT 5000`,
        [truckId, driverId, kind, review, from, to, flaggedOnly, customerId, productId],
      ),
      this.resolveFilterNames({ truckId, driverId, customerId, productId }),
    ]);

    const activeFilters: Array<{ label: string; value: string }> = [];
    if (from || to) {
      activeFilters.push({
        label: 'Date range (SAST)',
        value: `${from ?? 'Start'} to ${to ?? 'Present'}`,
      });
    }
    if (names.truck) activeFilters.push({ label: 'Vehicle', value: names.truck });
    if (names.driver) activeFilters.push({ label: 'Driver', value: names.driver });
    if (names.customer) activeFilters.push({ label: 'Customer', value: names.customer });
    if (names.product) activeFilters.push({ label: 'Product', value: names.product });
    if (kind) activeFilters.push({ label: 'Activity type', value: activityKindLabel[kind] ?? kind });
    if (review) activeFilters.push({ label: 'Review status', value: reviewLabel[review] ?? review });
    if (flaggedOnly) activeFilters.push({ label: 'Exceptions', value: 'Flagged only' });

    const columns: SheetColumn[] = [
      { key: 'occurredAt', header: 'Date & Time (SAST)', width: 18 },
      { key: 'registration', header: 'Registration', width: 15 },
      { key: 'truckIdentifier', header: 'Vehicle', width: 16 },
      { key: 'driverName', header: 'Driver', width: 20 },
      { key: 'kind', header: 'Activity Type', width: 15 },
      { key: 'review', header: 'Review Status', width: 17 },
      { key: 'customer', header: 'Customer', width: 22 },
      { key: 'product', header: 'Product', width: 20 },
      { key: 'origin', header: 'Collection Site', width: 22 },
      { key: 'destination', header: 'Delivery Site', width: 22 },
      { key: 'quantity', header: 'Quantity', format: 'decimal', sum: true, width: 12 },
      { key: 'unit', header: 'Unit', width: 10 },
      { key: 'variancePercent', header: 'Weight Var. %', format: 'decimal', width: 14 },
      { key: 'dwellMinutes', header: 'Dwell (min)', format: 'integer', width: 12 },
      { key: 'reference', header: 'Waybill / Receipt #', width: 18 },
      { key: 'fuelLitres', header: 'Fuel (L)', format: 'decimal', sum: true, width: 12 },
      { key: 'cost', header: 'Fuel / Road Cost (ZAR)', format: 'currency', sum: true, width: 20 },
      ...(showMoney
        ? [
            {
              key: 'revenue',
              header: 'Est. Revenue (ZAR)',
              format: 'currency' as const,
              sum: true,
              width: 18,
            },
          ]
        : []),
      { key: 'odometerKm', header: 'Odometer (km)', format: 'km', width: 15 },
      { key: 'attachments', header: 'Photos', format: 'integer', sum: true, width: 9 },
      { key: 'flags', header: 'Flags / Exceptions', width: 28, wrap: true },
      { key: 'note', header: 'Driver Note', width: 32, wrap: true },
    ];

    let totalRevenue = 0;
    let totalFuelSpend = 0;
    let totalExpenseSpend = 0;
    let totalTonnes = 0;
    let flaggedCount = 0;
    const byTypeCount = new Map<string, number>();

    const formattedRows = rows.map((r) => {
      const d = r.data;
      const qtyNum = toNum(d.quantity);
      const fuelCost = r.kind === 'fuel' ? toNum(d.fuelTotalCost) : null;
      const expCost = r.kind === 'expense' ? toNum(d.expenseAmount) : null;
      const rev = showMoney && r.pricingStatus === 'priced' ? toNum(r.amount) : null;
      const dwell = computeDwellMinutes(d.arrivedAt, d.departedAt);
      const variance =
        r.kind === 'delivery'
          ? calculateVariancePercent(d.collectedQuantity, d.quantity)
          : null;

      if (rev) totalRevenue += rev;
      if (fuelCost) totalFuelSpend += fuelCost;
      if (expCost) totalExpenseSpend += expCost;
      if (r.kind === 'delivery' && qtyNum) {
        totalTonnes += d.unit === 'kg' ? qtyNum / 1000 : d.unit === 'tonne' ? qtyNum : 0;
      }
      if (r.flags.length > 0) flaggedCount += 1;
      const typeName = activityKindLabel[r.kind] ?? r.kind;
      byTypeCount.set(typeName, (byTypeCount.get(typeName) ?? 0) + 1);

      return {
        occurredAt: formatSastDateTime(r.occurredAt),
        registration: r.registration,
        truckIdentifier: r.truckIdentifier,
        driverName: r.driverName,
        kind: typeName,
        review: reviewLabel[r.review] ?? r.review,
        customer: d.customer?.name ?? '',
        product: d.product?.name ?? '',
        origin: d.origin?.name ?? '',
        destination: d.destination?.name ?? '',
        quantity: qtyNum,
        unit: d.quantity ? d.unit : '',
        variancePercent: variance,
        dwellMinutes: dwell,
        reference:
          d.waybillNumber ||
          d.receiptNumber ||
          d.fuelStation ||
          d.vendorName ||
          '',
        fuelLitres: r.kind === 'fuel' ? toNum(d.fuelLitres) : null,
        cost: fuelCost ?? expCost,
        ...(showMoney ? { revenue: rev } : {}),
        odometerKm: toNum(d.odometerKm),
        attachments: r.attachmentCount,
        flags: formatFlags(r.flags),
        note: d.note ?? '',
      };
    });

    const kpis: KpiMetric[] = [
      {
        label: 'Matching Records',
        value: String(rows.length),
        numericValue: rows.length,
        format: 'integer',
        hint: `${flaggedCount} flagged`,
      },
      {
        label: 'Delivered Tonnes',
        value: `${totalTonnes.toLocaleString('en-ZA', { maximumFractionDigits: 2 })} t`,
        numericValue: Number(totalTonnes.toFixed(2)),
        format: 'decimal',
      },
      {
        label: 'Fuel & Road Spend',
        value: formatZarText(totalFuelSpend + totalExpenseSpend),
        numericValue: totalFuelSpend + totalExpenseSpend,
        format: 'currency',
        hint: `Fuel ${formatZarText(totalFuelSpend)}`,
      },
      ...(showMoney
        ? [
            {
              label: 'Priced Revenue',
              value: formatZarText(totalRevenue),
              numericValue: totalRevenue,
              format: 'currency' as const,
            },
          ]
        : [
            {
              label: 'Flagged Exceptions',
              value: String(flaggedCount),
              numericValue: flaggedCount,
              format: 'integer' as const,
            },
          ]),
    ];

    const summaryRows = [...byTypeCount.entries()].map(([type, count]) => ({
      type,
      count,
      share: rows.length > 0 ? count / rows.length : 0,
    }));

    const generatedAt = new Date().toISOString();
    const scopeTag = from || to ? `${from ?? 'start'}-to-${to ?? 'now'}` : operationalToday();

    return {
      dataset: 'activities',
      title: 'Driver Activity Ledger',
      subtitle: 'Filtered pickups, deliveries, petrol fill-ups, road expenses, dwell and variance proof.',
      scopeTag,
      generatedAt,
      activeFilters,
      kpis,
      primaryColumns: columns,
      primaryRows: formattedRows,
      sheets: [
        {
          name: 'Summary',
          metadata: {
            title: 'Driver Activity Report',
            subtitle: 'Executive summary of filtered driver pickups, deliveries, fuel and road expenses.',
            generatedAt,
            preparedBy: this.preparedBy(context),
            filters: activeFilters,
            currency: 'ZAR',
          },
          kpis,
          sectionTitle: 'Activity Breakdown by Type',
          columns: [
            { key: 'type', header: 'Activity Type', width: 24 },
            { key: 'count', header: 'Records', format: 'integer', sum: true, width: 14 },
            { key: 'share', header: '% of Total', format: 'percent', width: 14 },
          ],
          rows: summaryRows,
          showTotals: true,
          totalsLabel: 'Total Activities',
        },
        {
          name: 'Driver Activity',
          sectionTitle: 'Detailed Activity Ledger',
          columns,
          rows: formattedRows,
          showTotals: true,
          totalsLabel: `Total (${formattedRows.length} records)`,
        },
      ],
    };
  }

  private async prepareExpenses(
    context: AdminContext,
    query: Record<string, string | undefined>,
  ): Promise<PreparedReport> {
    const month = query.month?.trim() ? parseMonthString(query.month) : null;
    const from = parseOptionalDate(query.from);
    const to = parseOptionalDate(query.to);
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const category =
      query.category &&
      truckExpenseCategories.includes(query.category as TruckExpenseCategory)
        ? query.category
        : null;
    const source =
      query.source &&
      ['office_expense', 'driver_fuel', 'driver_expense', 'service_job'].includes(
        query.source,
      )
        ? (query.source as UnifiedExpenseRow['source'])
        : null;
    const includeVoid = query.includeVoid === 'true';

    const [listed, names] = await Promise.all([
      this.expenses.list(context, {
        month: month ?? undefined,
        truckId: truckId ?? undefined,
        category: category ?? undefined,
        includeVoid: includeVoid ? 'true' : undefined,
      }),
      this.resolveFilterNames({ truckId }),
    ]);

    const items = listed.items.filter((row) => {
      if (from && row.occurredOn < from) return false;
      if (to && row.occurredOn > to) return false;
      if (source && row.source !== source) return false;
      return true;
    });

    const activeFilters: Array<{ label: string; value: string }> = [];
    if (month) activeFilters.push({ label: 'Month', value: month });
    if (from || to) {
      activeFilters.push({
        label: 'Date range',
        value: `${from ?? 'Start'} to ${to ?? 'Present'}`,
      });
    }
    if (names.truck) activeFilters.push({ label: 'Vehicle', value: names.truck });
    if (category) {
      activeFilters.push({
        label: 'Category',
        value: expenseCategoryLabel[category] ?? category,
      });
    }
    if (source) {
      activeFilters.push({
        label: 'Source',
        value: expenseSourceLabel[source] ?? source,
      });
    }
    if (includeVoid) activeFilters.push({ label: 'Voided', value: 'Included' });

    const activeItems = items.filter((i) => !i.voidedAt);
    const totalAmount = activeItems.reduce((acc, r) => acc + Number(r.amount), 0);
    const totalLitres = activeItems.reduce(
      (acc, r) => acc + (r.litres ? Number(r.litres) : 0),
      0,
    );
    const fuelAmount = activeItems
      .filter((r) => r.category === 'fuel')
      .reduce((acc, r) => acc + Number(r.amount), 0);
    const repairAmount = activeItems
      .filter((r) => ['repair', 'tyres', 'maintenance'].includes(r.category))
      .reduce((acc, r) => acc + Number(r.amount), 0);

    const kpis: KpiMetric[] = [
      {
        label: 'Total Spend',
        value: formatZarText(totalAmount),
        numericValue: totalAmount,
        format: 'currency',
        hint: `${activeItems.length} active entr${activeItems.length === 1 ? 'y' : 'ies'}`,
      },
      {
        label: 'Fuel / Petrol',
        value: formatZarText(fuelAmount),
        numericValue: fuelAmount,
        format: 'currency',
        hint: totalLitres > 0 ? `${totalLitres.toFixed(1)} L` : undefined,
      },
      {
        label: 'Repairs & Tyres',
        value: formatZarText(repairAmount),
        numericValue: repairAmount,
        format: 'currency',
      },
      {
        label: 'Other Road / Ops',
        value: formatZarText(totalAmount - fuelAmount - repairAmount),
        numericValue: totalAmount - fuelAmount - repairAmount,
        format: 'currency',
      },
    ];

    const byCat = new Map<string, { category: string; count: number; amount: number }>();
    for (const r of activeItems) {
      const label = expenseCategoryLabel[r.category] ?? r.category;
      const cur = byCat.get(label) ?? { category: label, count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += Number(r.amount);
      byCat.set(label, cur);
    }
    const categorySummaryRows = [...byCat.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({
        ...c,
        share: totalAmount > 0 ? c.amount / totalAmount : 0,
      }));

    const ledgerColumns: SheetColumn[] = [
      { key: 'occurredOn', header: 'Date', width: 13 },
      { key: 'registration', header: 'Registration', width: 15 },
      { key: 'truckIdentifier', header: 'Vehicle', width: 16 },
      { key: 'driverName', header: 'Driver', width: 20 },
      { key: 'source', header: 'Source', width: 20 },
      { key: 'category', header: 'Category', width: 18 },
      { key: 'vendor', header: 'Vendor / Station', width: 24 },
      { key: 'reference', header: 'Invoice / Ref', width: 18 },
      { key: 'litres', header: 'Litres', format: 'decimal', sum: true, width: 12 },
      { key: 'odometerKm', header: 'Odometer (km)', format: 'km', width: 15 },
      { key: 'amount', header: 'Amount (ZAR)', format: 'currency', sum: true, width: 17 },
      { key: 'attachments', header: 'Receipts', format: 'integer', sum: true, width: 10 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'notes', header: 'Notes', width: 32, wrap: true },
    ];

    const ledgerRows = items.map((r) => ({
      occurredOn: r.occurredOn,
      registration: r.registration,
      truckIdentifier: r.truckIdentifier,
      driverName: r.driverName ?? '',
      source: expenseSourceLabel[r.source] ?? r.source,
      category: expenseCategoryLabel[r.category] ?? r.category,
      vendor: r.vendor,
      reference: r.reference,
      litres: toNum(r.litres),
      odometerKm: toNum(r.odometerKm),
      amount: Number(r.amount),
      attachments: r.attachmentCount,
      status: r.voidedAt ? 'Voided' : 'Active',
      notes: r.notes,
    }));

    const generatedAt = new Date().toISOString();
    const scopeTag =
      month ?? (from || to ? `${from ?? 'start'}-to-${to ?? 'now'}` : operationalToday());

    return {
      dataset: 'expenses',
      title: 'Expenses & Spend Ledger',
      subtitle: 'Unified petrol, workshop repairs, breakdown jobs, tolls, and office invoices.',
      scopeTag,
      generatedAt,
      activeFilters,
      kpis,
      primaryColumns: ledgerColumns,
      primaryRows: ledgerRows,
      sheets: [
        {
          name: 'Spend Summary',
          metadata: {
            title: 'Fleet Expenses & Spend Report',
            subtitle: 'Unified view of driver fuel/road costs, breakdown jobs, and office invoices.',
            generatedAt,
            preparedBy: this.preparedBy(context),
            filters: activeFilters,
            currency: 'ZAR',
          },
          kpis,
          sectionTitle: 'Spend Breakdown by Category',
          columns: [
            { key: 'category', header: 'Category', width: 24 },
            { key: 'count', header: 'Entries', format: 'integer', sum: true, width: 12 },
            { key: 'amount', header: 'Amount (ZAR)', format: 'currency', sum: true, width: 18 },
            { key: 'share', header: '% of Spend', format: 'percent', width: 14 },
          ],
          rows: categorySummaryRows,
          showTotals: true,
          totalsLabel: 'Total Active Spend',
        },
        {
          name: 'Expense Ledger',
          sectionTitle: 'Detailed Expense Transactions',
          columns: ledgerColumns,
          rows: ledgerRows,
          showTotals: true,
          totalsLabel: `Total (${ledgerRows.length} entries)`,
        },
      ],
    };
  }

  private async prepareShifts(
    context: AdminContext,
    query: Record<string, string | undefined>,
  ): Promise<PreparedReport> {
    if (!context.permissions.includes('shifts.read')) {
      throw new ForbiddenError('Shifts and mileage access is required.');
    }
    const em = getEm(this.orm);
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const driverId = uuidField(query.driverId, 'driver', false);
    const from = parseOptionalDate(query.from);
    const to = parseOptionalDate(query.to);
    const flaggedOnly = query.flagged === 'true';

    const where: FilterQuery<DrivingSession> = {};
    if (truckId) where.truck = truckId;
    if (driverId) where.driver = driverId;
    if (from && to) {
      where.confirmedDate = { $gte: from, $lte: to };
    } else if (from) {
      where.confirmedDate = { $gte: from };
    } else if (to) {
      where.confirmedDate = { $lte: to };
    }

    const [sessions, names] = await Promise.all([
      em.find(DrivingSession, where, {
        populate: ['truck', 'driver.user', 'mileageReviewedBy'],
        orderBy: { startedAt: 'desc' },
        limit: 2000,
      }),
      this.resolveFilterNames({ truckId, driverId }),
    ]);

    const filtered = flaggedOnly
      ? sessions.filter((s) => s.mileageFlags.length > 0 && !s.mileageReviewedAt)
      : sessions;

    const sessionIds = filtered.map((s) => s.id);
    const attachments = sessionIds.length
      ? await em.find(TransportAttachment, {
          drivingSession: { $in: sessionIds },
        })
      : [];
    const photoCounts = new Map<string, number>();
    for (const a of attachments) {
      const sid = a.drivingSession?.id;
      if (sid) photoCounts.set(sid, (photoCounts.get(sid) ?? 0) + 1);
    }

    const activeFilters: Array<{ label: string; value: string }> = [];
    if (from || to) {
      activeFilters.push({
        label: 'Date range',
        value: `${from ?? 'Start'} to ${to ?? 'Present'}`,
      });
    }
    if (names.truck) activeFilters.push({ label: 'Vehicle', value: names.truck });
    if (names.driver) activeFilters.push({ label: 'Driver', value: names.driver });
    if (flaggedOnly) {
      activeFilters.push({ label: 'Exceptions', value: 'Flagged / unreviewed only' });
    }

    let totalKm = 0;
    let activeShifts = 0;
    let flaggedShifts = 0;
    const kmByTruck = new Map<
      string,
      { registration: string; truckName: string; shifts: number; km: number; flagged: number }
    >();

    const shiftColumns: SheetColumn[] = [
      { key: 'confirmedDate', header: 'Date', width: 13 },
      { key: 'registration', header: 'Registration', width: 15 },
      { key: 'truckIdentifier', header: 'Vehicle', width: 16 },
      { key: 'driverName', header: 'Driver', width: 20 },
      { key: 'startedAt', header: 'Clock-In (SAST)', width: 18 },
      { key: 'endedAt', header: 'Clock-Out (SAST)', width: 18 },
      { key: 'startOdometerKm', header: 'Start KM', format: 'km', width: 13 },
      { key: 'endOdometerKm', header: 'End KM', format: 'km', width: 13 },
      { key: 'distanceKm', header: 'Distance (km)', format: 'km', sum: true, width: 14 },
      { key: 'status', header: 'Status', width: 13 },
      { key: 'reviewed', header: 'Reviewed', width: 14 },
      { key: 'photos', header: 'Proof Photos', format: 'integer', sum: true, width: 13 },
      { key: 'flags', header: 'Exceptions / Flags', width: 28, wrap: true },
      { key: 'endReason', header: 'End Reason', width: 16 },
    ];

    const shiftRows = filtered.map((s) => {
      const dist = computeShiftDistanceKm(s.startOdometerKm, s.endOdometerKm);
      if (dist !== null) totalKm += dist;
      if (!s.endedAt) activeShifts += 1;
      if (s.mileageFlags.length > 0) flaggedShifts += 1;

      const cur = kmByTruck.get(s.truck.id) ?? {
        registration: s.truck.registration,
        truckName: s.truck.identifier,
        shifts: 0,
        km: 0,
        flagged: 0,
      };
      cur.shifts += 1;
      if (dist !== null) cur.km += dist;
      if (s.mileageFlags.length > 0) cur.flagged += 1;
      kmByTruck.set(s.truck.id, cur);

      return {
        confirmedDate: s.confirmedDate,
        registration: s.truck.registration,
        truckIdentifier: s.truck.identifier,
        driverName: userFullName(s.driver.user),
        startedAt: formatSastDateTime(s.startedAt),
        endedAt: formatSastDateTime(s.endedAt),
        startOdometerKm: toNum(s.startOdometerKm),
        endOdometerKm: toNum(s.endOdometerKm),
        distanceKm: dist,
        status: s.endedAt ? 'Completed' : 'Active',
        reviewed: s.mileageReviewedAt ? 'Reviewed' : 'Pending',
        photos: photoCounts.get(s.id) ?? 0,
        flags: formatFlags(s.mileageFlags),
        endReason: s.endReason ?? '',
      };
    });

    const kpis: KpiMetric[] = [
      {
        label: 'Total Shifts',
        value: String(filtered.length),
        numericValue: filtered.length,
        format: 'integer',
        hint: `${activeShifts} active`,
      },
      {
        label: 'Total Distance',
        value: `${totalKm.toLocaleString('en-ZA', { maximumFractionDigits: 1 })} km`,
        numericValue: Number(totalKm.toFixed(1)),
        format: 'km',
      },
      {
        label: 'Flagged Shifts',
        value: String(flaggedShifts),
        numericValue: flaggedShifts,
        format: 'integer',
      },
      {
        label: 'Vehicles Covered',
        value: String(kmByTruck.size),
        numericValue: kmByTruck.size,
        format: 'integer',
      },
    ];

    const truckSummaryRows = [...kmByTruck.values()].sort((a, b) => b.km - a.km);
    const generatedAt = new Date().toISOString();
    const scopeTag = from || to ? `${from ?? 'start'}-to-${to ?? 'now'}` : operationalToday();

    return {
      dataset: 'shifts',
      title: 'Shifts & Mileage Proof',
      subtitle: 'Driver clock-in/clock-out odometer readings, km driven, and dashboard photo proof.',
      scopeTag,
      generatedAt,
      activeFilters,
      kpis,
      primaryColumns: shiftColumns,
      primaryRows: shiftRows,
      sheets: [
        {
          name: 'Mileage Summary',
          metadata: {
            title: 'Shifts & Mileage Proof Report',
            subtitle: 'Start and end odometer readings, distance travelled, and mileage exceptions.',
            generatedAt,
            preparedBy: this.preparedBy(context),
            filters: activeFilters,
          },
          kpis,
          sectionTitle: 'Distance Summary by Vehicle',
          columns: [
            { key: 'registration', header: 'Registration', width: 16 },
            { key: 'truckName', header: 'Vehicle', width: 18 },
            { key: 'shifts', header: 'Shifts', format: 'integer', sum: true, width: 12 },
            { key: 'km', header: 'Total KM', format: 'km', sum: true, width: 15 },
            { key: 'flagged', header: 'Flagged Shifts', format: 'integer', sum: true, width: 15 },
          ],
          rows: truckSummaryRows,
          showTotals: true,
          totalsLabel: `Fleet Total (${truckSummaryRows.length} vehicles)`,
        },
        {
          name: 'Shifts & Mileage',
          sectionTitle: 'Detailed Shift Mileage Log',
          columns: shiftColumns,
          rows: shiftRows,
          cellFormula: (_rIdx, excelRowNum, colKey, row) => {
            if (
              colKey === 'distanceKm' &&
              typeof row.startOdometerKm === 'number' &&
              typeof row.endOdometerKm === 'number'
            ) {
              return `H${excelRowNum}-G${excelRowNum}`;
            }
            return null;
          },
          showTotals: true,
          totalsLabel: `Total (${shiftRows.length} shifts)`,
        },
      ],
    };
  }

  private async prepareDispatches(
    context: AdminContext,
    query: Record<string, string | undefined>,
  ): Promise<PreparedReport> {
    if (!context.permissions.includes('dispatch.read')) {
      throw new ForbiddenError('Dispatch access is required.');
    }
    const em = getEm(this.orm);
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const driverId = uuidField(query.driverId, 'driver', false);
    const customerId = uuidField(query.customerId, 'customer', false);
    const from = parseOptionalDate(query.from);
    const to = parseOptionalDate(query.to);
    const status =
      query.status && dispatchStatuses.includes(query.status as DispatchStatus)
        ? (query.status as DispatchStatus)
        : null;

    const where: FilterQuery<Dispatch> = {};
    if (truckId) where.truck = truckId;
    if (driverId) where.driver = driverId;
    if (status) where.status = status;
    if (from && to) {
      where.date = { $gte: from, $lte: to };
    } else if (from) {
      where.date = { $gte: from };
    } else if (to) {
      where.date = { $lte: to };
    }

    const [dispatches, names] = await Promise.all([
      em.find(Dispatch, where, {
        populate: ['truck', 'driver.user'],
        orderBy: { date: 'desc', createdAt: 'desc' },
        limit: 2000,
      }),
      this.resolveFilterNames({ truckId, driverId, customerId }),
    ]);

    const filtered = customerId
      ? dispatches.filter((d) => d.plan.customer.id === customerId)
      : dispatches;

    const activeFilters: Array<{ label: string; value: string }> = [];
    if (from || to) {
      activeFilters.push({
        label: 'Date range',
        value: `${from ?? 'Start'} to ${to ?? 'Present'}`,
      });
    }
    if (names.truck) activeFilters.push({ label: 'Vehicle', value: names.truck });
    if (names.driver) activeFilters.push({ label: 'Driver', value: names.driver });
    if (names.customer) activeFilters.push({ label: 'Customer', value: names.customer });
    if (status) activeFilters.push({ label: 'Status', value: status });

    const columns: SheetColumn[] = [
      { key: 'date', header: 'Date', width: 13 },
      { key: 'reference', header: 'Reference', width: 16 },
      { key: 'status', header: 'Status', width: 13 },
      { key: 'registration', header: 'Registration', width: 15 },
      { key: 'truckIdentifier', header: 'Vehicle', width: 16 },
      { key: 'driverName', header: 'Driver', width: 20 },
      { key: 'customer', header: 'Customer', width: 22 },
      { key: 'product', header: 'Product', width: 20 },
      { key: 'origin', header: 'Collection Site', width: 22 },
      { key: 'destinations', header: 'Drop-off Sites', width: 28, wrap: true },
      { key: 'quantity', header: 'Planned Qty', format: 'decimal', sum: true, width: 14 },
      { key: 'unit', header: 'Unit', width: 10 },
      { key: 'stops', header: 'Stops', format: 'integer', sum: true, width: 9 },
      { key: 'notes', header: 'Notes', width: 28, wrap: true },
    ];

    const byStatus = new Map<string, number>();
    let totalPlannedQty = 0;

    const rows = filtered.map((d) => {
      byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);
      const qty = toNum(d.plan.quantity);
      if (qty) totalPlannedQty += qty;
      return {
        date: d.date,
        reference: d.reference,
        status: d.status,
        registration: d.truck.registration,
        truckIdentifier: d.truck.identifier,
        driverName: userFullName(d.driver.user),
        customer: d.plan.customer.name ?? '',
        product: d.plan.product.name ?? '',
        origin: d.plan.origin.name ?? '',
        destinations: d.plan.deliveries
          .map((s) => s.destination.name)
          .filter(Boolean)
          .join('; '),
        quantity: qty,
        unit: d.plan.unit,
        stops: d.plan.deliveries.length,
        notes: d.plan.instructions ?? '',
      };
    });

    const kpis: KpiMetric[] = [
      {
        label: 'Total Dispatches',
        value: String(filtered.length),
        numericValue: filtered.length,
        format: 'integer',
      },
      {
        label: 'Active / Dispatched',
        value: String(byStatus.get('dispatched') ?? 0),
        numericValue: byStatus.get('dispatched') ?? 0,
        format: 'integer',
      },
      {
        label: 'Completed',
        value: String(byStatus.get('completed') ?? 0),
        numericValue: byStatus.get('completed') ?? 0,
        format: 'integer',
      },
      {
        label: 'Planned Quantity',
        value: totalPlannedQty.toLocaleString('en-ZA', { maximumFractionDigits: 2 }),
        numericValue: Number(totalPlannedQty.toFixed(2)),
        format: 'decimal',
      },
    ];

    const statusRows = [...byStatus.entries()].map(([st, count]) => ({
      status: st,
      count,
      share: filtered.length > 0 ? count / filtered.length : 0,
    }));

    const generatedAt = new Date().toISOString();
    const scopeTag = from || to ? `${from ?? 'start'}-to-${to ?? 'now'}` : operationalToday();

    return {
      dataset: 'dispatches',
      title: 'Dispatch & Load Plan',
      subtitle: 'Planned collections, multi-stop drop-offs, vehicle/driver allocation and status.',
      scopeTag,
      generatedAt,
      activeFilters,
      kpis,
      primaryColumns: columns,
      primaryRows: rows,
      sheets: [
        {
          name: 'Dispatch Summary',
          metadata: {
            title: 'Dispatch & Load Plan Report',
            subtitle: 'Summary of planned and dispatched fleet loads.',
            generatedAt,
            preparedBy: this.preparedBy(context),
            filters: activeFilters,
          },
          kpis,
          sectionTitle: 'Dispatches by Status',
          columns: [
            { key: 'status', header: 'Status', width: 20 },
            { key: 'count', header: 'Dispatches', format: 'integer', sum: true, width: 14 },
            { key: 'share', header: '% of Total', format: 'percent', width: 14 },
          ],
          rows: statusRows,
          showTotals: true,
          totalsLabel: 'Total Dispatches',
        },
        {
          name: 'Dispatches',
          sectionTitle: 'Dispatch Ledger',
          columns,
          rows,
          showTotals: true,
          totalsLabel: `Total (${rows.length} dispatches)`,
        },
      ],
    };
  }

  private async prepare(
    context: AdminContext,
    rawDataset: string | undefined,
    query: Record<string, string | undefined>,
  ): Promise<PreparedReport> {
    const dataset = parseDataset(rawDataset);
    switch (dataset) {
      case 'earnings':
        return this.prepareEarnings(context, query);
      case 'activities':
        return this.prepareActivities(context, query);
      case 'expenses':
        return this.prepareExpenses(context, query);
      case 'shifts':
        return this.prepareShifts(context, query);
      case 'dispatches':
        return this.prepareDispatches(context, query);
    }
  }

  async preview(
    context: AdminContext,
    query: Record<string, string | undefined> = {},
  ): Promise<ReportPreviewResult> {
    const prepared = await this.prepare(context, query.dataset, query);
    const previewLimit = 25;
    const slice = prepared.primaryRows.slice(0, previewLimit).map((row) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const col of prepared.primaryColumns) {
        const v = row[col.key];
        out[col.key] = v === undefined ? null : v;
      }
      return out;
    });

    return {
      dataset: prepared.dataset,
      title: prepared.title,
      subtitle: prepared.subtitle,
      generatedAt: prepared.generatedAt,
      currency: 'ZAR',
      activeFilters: prepared.activeFilters,
      kpis: prepared.kpis.map(({ label, value, hint }) => ({
        label,
        value,
        ...(hint ? { hint } : {}),
      })),
      totalRows: prepared.primaryRows.length,
      columns: prepared.primaryColumns.map((c) => ({
        key: c.key,
        header: c.header,
        format: c.format,
      })),
      rows: slice,
      truncated: prepared.primaryRows.length > previewLimit,
    };
  }

  async exportReport(
    context: AdminContext,
    query: Record<string, string | undefined> = {},
  ): Promise<{
    filename: string;
    contentType: string;
    buffer: Buffer;
  }> {
    const format = parseFormat(query.format);
    const prepared = await this.prepare(context, query.dataset, query);
    const filename = buildReportFilename(
      prepared.dataset,
      format,
      prepared.scopeTag,
    );

    if (format === 'csv') {
      return {
        filename,
        contentType: 'text/csv; charset=utf-8',
        buffer: buildCsvBuffer(prepared.primaryColumns, prepared.primaryRows),
      };
    }

    const buffer = await buildExcelWorkbook(
      prepared.sheets,
      this.preparedBy(context),
    );
    return {
      filename,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    };
  }
}
