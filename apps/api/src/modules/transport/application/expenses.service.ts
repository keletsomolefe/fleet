import type { FilterQuery, MikroORM } from '@mikro-orm/postgresql';
import { getEm, rawQuery } from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import { uuidField } from '../../../shared/validation.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import { ServiceJob } from '../../service-jobs/domain/service-job.entity.js';
import {
  TransportAttachment,
  TransportAudit,
} from '../domain/activity.entity.js';
import {
  TruckExpense,
  truckExpenseCategories,
  type TruckExpenseCategory,
} from '../domain/expense.entity.js';
import {
  parseMonthString,
  parseTruckExpenseInput,
  parseVoidReason,
  toTruckExpenseDto,
} from '../http/transport.dto.js';

export interface UnifiedExpenseRow {
  id: string;
  source: 'office_expense' | 'driver_fuel' | 'driver_expense' | 'service_job';
  occurredOn: string;
  occurredAt: string | null;
  truckId: string;
  registration: string;
  truckIdentifier: string;
  driverName: string | null;
  category: string;
  vendor: string;
  reference: string;
  amount: string;
  litres: string | null;
  odometerKm: string | null;
  notes: string;
  attachmentCount: number;
  serviceJobId: string | null;
  recordId: string | null;
  voidedAt: string | null;
}

export class ExpensesService {
  constructor(
    private readonly orm: MikroORM,
    private readonly events: OperationsEventsService,
  ) {}

  private assertCanRead(context: AdminContext) {
    if (
      !context.permissions.includes('expenses.read') &&
      !context.permissions.includes('revenue.read')
    ) {
      throw new ForbiddenError('Expense access is required.');
    }
  }

  private assertCanWrite(context: AdminContext) {
    if (!context.permissions.includes('expenses.write')) {
      throw new ForbiddenError('Expense management access is required.');
    }
  }

  async list(
    context: AdminContext,
    query: Record<string, string | undefined> = {},
  ) {
    this.assertCanRead(context);
    const em = getEm(this.orm);
    const month = query.month ? parseMonthString(query.month) : null;
    const truckId = uuidField(query.truckId, 'vehicle', false);
    const category =
      query.category &&
      truckExpenseCategories.includes(query.category as TruckExpenseCategory)
        ? (query.category as TruckExpenseCategory)
        : null;
    const includeVoid = query.includeVoid === 'true';

    // 1. Office-entered TruckExpenses
    const where: FilterQuery<TruckExpense> = {};
    if (truckId) where.truck = truckId;
    if (category) where.category = category;
    if (!includeVoid) where.voidedAt = null;
    if (month) {
      const start = `${month}-01`;
      const [y, m] = month.split('-').map(Number);
      const next =
        m === 12
          ? `${y + 1}-01-01`
          : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      where.occurredOn = { $gte: start, $lt: next };
    }

    const officeRows = await em.find(TruckExpense, where, {
      populate: ['truck', 'driver.user', 'serviceJob'],
      orderBy: { occurredOn: 'desc', createdAt: 'desc' },
      limit: 300,
    });

    const officeIds = officeRows.map((row) => row.id);
    const officeAttachments = officeIds.length
      ? await em.find(TransportAttachment, {
          truckExpense: { $in: officeIds },
        })
      : [];
    const attachmentsByExpense = new Map<string, TransportAttachment[]>();
    for (const attachment of officeAttachments) {
      const eid = attachment.truckExpense?.id;
      if (!eid) continue;
      const list = attachmentsByExpense.get(eid) ?? [];
      list.push(attachment);
      attachmentsByExpense.set(eid, list);
    }

    const officeItems: UnifiedExpenseRow[] = officeRows.map((row) => ({
      id: row.id,
      source: 'office_expense',
      occurredOn: row.occurredOn,
      occurredAt: row.createdAt.toISOString(),
      truckId: row.truck.id,
      registration: row.truck.registration,
      truckIdentifier: row.truck.identifier,
      driverName: row.driver ? userFullName(row.driver.user) : null,
      category: row.category,
      vendor: row.vendor,
      reference: row.invoiceNumber,
      amount: row.amount,
      litres: row.litres,
      odometerKm: row.odometerKm,
      notes: row.notes,
      attachmentCount: (attachmentsByExpense.get(row.id) ?? []).length,
      serviceJobId: row.serviceJob?.id ?? null,
      recordId: null,
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    }));

    // 2. Driver fuel & road expense TransportRecords
    const monthStart = month ? `${month}-01` : null;
    const driverRows = await rawQuery<{
      id: string;
      kind: 'fuel' | 'expense';
      occurredOn: string;
      occurredAt: string;
      truckId: string;
      registration: string;
      truckIdentifier: string;
      driverName: string;
      category: string;
      vendor: string;
      reference: string;
      amount: string;
      litres: string | null;
      odometerKm: string | null;
      notes: string;
      attachmentCount: number;
    }>(
      em,
      `SELECT r.id,
              r.kind,
              to_char((r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date, 'YYYY-MM-DD') AS "occurredOn",
              r."occurredAt",
              r."truckId",
              t.registration,
              t.identifier AS "truckIdentifier",
              concat(u."firstName", ' ', u."lastName") AS "driverName",
              CASE WHEN r.kind = 'fuel' THEN 'fuel' ELSE COALESCE(r.data->>'expenseCategory', 'other') END AS category,
              CASE WHEN r.kind = 'fuel' THEN COALESCE(r.data->>'fuelStation', '') ELSE COALESCE(r.data->>'vendorName', '') END AS vendor,
              COALESCE(r.data->>'receiptNumber', '') AS reference,
              CASE WHEN r.kind = 'fuel' THEN COALESCE(r.data->>'fuelTotalCost', '0.00') ELSE COALESCE(r.data->>'expenseAmount', '0.00') END AS amount,
              CASE WHEN r.kind = 'fuel' THEN r.data->>'fuelLitres' ELSE NULL END AS litres,
              r.data->>'odometerKm' AS "odometerKm",
              COALESCE(r.data->>'note', '') AS notes,
              (SELECT count(*)::int FROM app.transport_attachments a WHERE a."recordId" = r.id) AS "attachmentCount"
       FROM app.transport_records r
       JOIN app.trucks t ON t.id = r."truckId"
       JOIN app.driver_profiles dp ON dp.id = r."driverId"
       JOIN app.users u ON u.id = dp."userId"
       WHERE r.kind IN ('fuel', 'expense')
         AND r.review <> 'void'
         AND ($1::uuid IS NULL OR r."truckId" = $1::uuid)
         AND ($2::date IS NULL OR ((r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date >= $2::date AND (r."occurredAt" AT TIME ZONE 'Africa/Johannesburg')::date < $2::date + interval '1 month'))
         AND ($3::text IS NULL OR (CASE WHEN r.kind = 'fuel' THEN 'fuel' ELSE COALESCE(r.data->>'expenseCategory', 'other') END) = $3::text)
       ORDER BY r."occurredAt" DESC
       LIMIT 300`,
      [truckId, monthStart, category],
    );

    const driverItems: UnifiedExpenseRow[] = driverRows.map((row) => ({
      id: `rec:${row.id}`,
      source: row.kind === 'fuel' ? 'driver_fuel' : 'driver_expense',
      occurredOn: row.occurredOn,
      occurredAt: new Date(row.occurredAt).toISOString(),
      truckId: row.truckId,
      registration: row.registration,
      truckIdentifier: row.truckIdentifier,
      driverName: row.driverName,
      category: row.category,
      vendor: row.vendor,
      reference: row.reference,
      amount: row.amount,
      litres: row.litres,
      odometerKm: row.odometerKm,
      notes: row.notes,
      attachmentCount: row.attachmentCount,
      serviceJobId: null,
      recordId: row.id,
      voidedAt: null,
    }));

    // 3. Service Jobs with completionCostCents (repairs/towing/tyres/etc.)
    const includeServiceJobs =
      !category || category === 'repair' || category === 'tyres' || category === 'fuel';
    const jobRows = includeServiceJobs
      ? await rawQuery<{
          id: string;
          reference: string;
          serviceType: string;
          occurredOn: string;
          occurredAt: string;
          truckId: string;
          registration: string;
          truckIdentifier: string;
          driverName: string | null;
          vendor: string;
          amount: string;
          notes: string;
          attachmentCount: number;
        }>(
          em,
          `SELECT j.id,
                  j.reference,
                  j."serviceType",
                  to_char((COALESCE(j."completedAt", j."closedAt", j."createdAt") AT TIME ZONE 'Africa/Johannesburg')::date, 'YYYY-MM-DD') AS "occurredOn",
                  COALESCE(j."completedAt", j."closedAt", j."createdAt") AS "occurredAt",
                  j."truckId",
                  t.registration,
                  t.identifier AS "truckIdentifier",
                  CASE WHEN u.id IS NOT NULL THEN concat(u."firstName", ' ', u."lastName") ELSE NULL END AS "driverName",
                  COALESCE(sp."companyName", 'Service provider') AS vendor,
                  to_char((j."completionCostCents"::numeric / 100), 'FM999999999990.00') AS amount,
                  COALESCE(j."completionNote", j.title) AS notes,
                  (SELECT count(*)::int FROM app.service_job_attachments a WHERE a."jobId" = j.id) AS "attachmentCount"
           FROM app.service_jobs j
           JOIN app.trucks t ON t.id = j."truckId"
           LEFT JOIN app.driver_profiles dp ON dp.id = j."driverId"
           LEFT JOIN app.users u ON u.id = dp."userId"
           LEFT JOIN app.service_providers sp ON sp.id = j."providerId"
           WHERE j.status IN ('completed', 'closed')
             AND j."completionCostCents" IS NOT NULL
             AND j."completionCostCents" > 0
             AND ($1::uuid IS NULL OR j."truckId" = $1::uuid)
             AND ($2::date IS NULL OR ((COALESCE(j."completedAt", j."closedAt", j."createdAt") AT TIME ZONE 'Africa/Johannesburg')::date >= $2::date AND (COALESCE(j."completedAt", j."closedAt", j."createdAt") AT TIME ZONE 'Africa/Johannesburg')::date < $2::date + interval '1 month'))
           ORDER BY COALESCE(j."completedAt", j."closedAt", j."createdAt") DESC
           LIMIT 300`,
          [truckId, monthStart],
        )
      : [];

    const serviceJobItems: UnifiedExpenseRow[] = jobRows
      .filter((row) => {
        if (!category) return true;
        if (category === 'tyres') return row.serviceType === 'tyres';
        if (category === 'fuel') return row.serviceType === 'fuel';
        return category === 'repair';
      })
      .map((row) => ({
        id: `job:${row.id}`,
        source: 'service_job',
        occurredOn: row.occurredOn,
        occurredAt: new Date(row.occurredAt).toISOString(),
        truckId: row.truckId,
        registration: row.registration,
        truckIdentifier: row.truckIdentifier,
        driverName: row.driverName,
        category:
          row.serviceType === 'tyres'
            ? 'tyres'
            : row.serviceType === 'fuel'
              ? 'fuel'
              : 'repair',
        vendor: row.vendor,
        reference: row.reference,
        amount: row.amount,
        litres: null,
        odometerKm: null,
        notes: row.notes,
        attachmentCount: row.attachmentCount,
        serviceJobId: row.id,
        recordId: null,
        voidedAt: null,
      }));

    const items = [...officeItems, ...driverItems, ...serviceJobItems].sort(
      (a, b) =>
        b.occurredOn.localeCompare(a.occurredOn) ||
        (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''),
    );

    const officeDtos = officeRows.map((row) =>
      toTruckExpenseDto(row, {
        registration: row.truck.registration,
        truckIdentifier: row.truck.identifier,
        driverName: row.driver ? userFullName(row.driver.user) : null,
        serviceJobReference: row.serviceJob?.reference ?? null,
        attachments: attachmentsByExpense.get(row.id) ?? [],
      }),
    );

    return { items, officeExpenses: officeDtos };
  }

  async create(context: AdminContext, raw: unknown) {
    this.assertCanWrite(context);
    const input = parseTruckExpenseInput(raw);

    const created = await getEm(this.orm).transactional(async (tx) => {
      const truck = await tx.findOne(Truck, { id: input.truckId });
      if (!truck) throw new BadRequestError('Choose a valid vehicle.');

      const driver = input.driverId
        ? await tx.findOne(
            DriverProfile,
            { id: input.driverId },
            { populate: ['user'] },
          )
        : null;
      if (input.driverId && !driver) {
        throw new BadRequestError('Choose a valid driver.');
      }

      const job = input.serviceJobId
        ? await tx.findOne(ServiceJob, { id: input.serviceJobId })
        : null;
      if (input.serviceJobId && !job) {
        throw new BadRequestError('Choose a valid service job.');
      }

      const expense = tx.create(TruckExpense, {
        truck,
        driver,
        serviceJob: job,
        occurredOn: input.occurredOn,
        category: input.category,
        vendor: input.vendor,
        invoiceNumber: input.invoiceNumber,
        amount: input.amount,
        litres: input.litres,
        odometerKm: input.odometerKm,
        notes: input.notes,
        createdBy: tx.getReference(User, context.user.id),
      });
      await tx.persist(expense).flush();

      tx.persist(
        tx.create(TransportAudit, {
          recordId: expense.id,
          entityType: 'truck_expense',
          actor: tx.getReference(User, context.user.id),
          action: 'created',
          reason: 'Office expense recorded',
          before: {},
          after: {
            truckId: truck.id,
            occurredOn: expense.occurredOn,
            category: expense.category,
            amount: expense.amount,
            vendor: expense.vendor,
            invoiceNumber: expense.invoiceNumber,
          },
        }),
      );
      await tx.flush();

      return toTruckExpenseDto(expense, {
        registration: truck.registration,
        truckIdentifier: truck.identifier,
        driverName: driver ? userFullName(driver.user) : null,
        serviceJobReference: job?.reference ?? null,
      });
    });

    this.events.changed();
    return created;
  }

  async voidExpense(context: AdminContext, rawId: string, raw: unknown) {
    this.assertCanWrite(context);
    const id = assertUuid(rawId, 'Choose a valid expense.');
    const reason = parseVoidReason(raw);

    const updated = await getEm(this.orm).transactional(async (tx) => {
      const expense = await tx.findOne(
        TruckExpense,
        { id },
        { populate: ['truck', 'driver.user', 'serviceJob'] },
      );
      if (!expense) throw new NotFoundError('Expense not found.');
      if (expense.voidedAt) {
        throw new ConflictError('This expense has already been voided.');
      }
      const before = {
        amount: expense.amount,
        category: expense.category,
        voidedAt: null,
      };
      expense.voidedAt = new Date();
      expense.voidedBy = tx.getReference(User, context.user.id);
      expense.voidReason = reason;

      tx.persist(
        tx.create(TransportAudit, {
          recordId: expense.id,
          entityType: 'truck_expense',
          actor: tx.getReference(User, context.user.id),
          action: 'voided',
          reason,
          before,
          after: {
            amount: expense.amount,
            category: expense.category,
            voidedAt: expense.voidedAt.toISOString(),
            voidReason: reason,
          },
        }),
      );
      await tx.flush();

      return toTruckExpenseDto(expense, {
        registration: expense.truck.registration,
        truckIdentifier: expense.truck.identifier,
        driverName: expense.driver ? userFullName(expense.driver.user) : null,
        serviceJobReference: expense.serviceJob?.reference ?? null,
      });
    });

    this.events.changed();
    return updated;
  }
}
