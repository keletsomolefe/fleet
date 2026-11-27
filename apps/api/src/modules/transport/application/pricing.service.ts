import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  acquireAdvisoryLock,
  getEm,
  rawQuery,
} from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { User } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import { CustomerProduct, Location } from '../domain/catalogue.entity.js';
import { TransportRate } from '../domain/rate.entity.js';
import {
  parseCreateRateInput,
  parseEndRateInput,
  toRateDto,
} from '../http/transport.dto.js';

export class PricingService {
  constructor(
    private readonly orm: MikroORM,
    private readonly events: OperationsEventsService,
  ) {}

  async listRates(context: AdminContext) {
    if (!context.permissions.includes('pricing.read')) {
      throw new ForbiddenError('Rate access is required.');
    }
    const em = getEm(this.orm);
    const rates = await em.find(
      TransportRate,
      {},
      { orderBy: { startsOn: 'desc', createdAt: 'desc' } },
    );
    return rates.map(toRateDto);
  }

  async createRate(context: AdminContext, raw: unknown) {
    if (!context.permissions.includes('pricing.write')) {
      throw new ForbiddenError('Rate management access is required.');
    }
    const input = parseCreateRateInput(raw);

    const created = await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-transport-rates-v1');

      const link = await tx.findOne(CustomerProduct, {
        id: input.customerProductId,
      });
      if (!link) {
        throw new BadRequestError('Choose a valid customer product.');
      }
      if (input.originId && input.destinationId) {
        const count = await tx.count(Location, {
          id: { $in: [...new Set([input.originId, input.destinationId])] },
        });
        const expected = input.originId === input.destinationId ? 1 : 2;
        if (count !== expected) {
          throw new BadRequestError('Choose valid collection and delivery sites.');
        }
      }

      const overlaps = await rawQuery<{ id: string }>(
        tx,
        `SELECT id FROM app.transport_rates
         WHERE "customerProductId" = $1::uuid
           AND "originId" IS NOT DISTINCT FROM $2::uuid
           AND "destinationId" IS NOT DISTINCT FROM $3::uuid
           AND "startsOn" <= COALESCE($5::date, '9999-12-31'::date)
           AND COALESCE("endsOn", '9999-12-31'::date) >= $4::date
         LIMIT 1`,
        [
          input.customerProductId,
          input.originId,
          input.destinationId,
          input.startsOn,
          input.endsOn,
        ],
      );
      if (overlaps.length > 0) {
        throw new ConflictError(
          'An active rate already covers part of this date range. End the existing rate first.',
        );
      }

      const rate = tx.create(TransportRate, {
        customerProduct: link,
        origin: input.originId ? tx.getReference(Location, input.originId) : null,
        destination: input.destinationId
          ? tx.getReference(Location, input.destinationId)
          : null,
        method: input.method,
        basis: input.basis,
        unit: input.unit,
        price: input.price,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        createdBy: tx.getReference(User, context.user.id),
      });
      await tx.persist(rate).flush();
      return rate;
    });

    this.events.changed();
    return toRateDto(created);
  }

  async endRate(context: AdminContext, rateId: string, raw: unknown) {
    if (!context.permissions.includes('pricing.write')) {
      throw new ForbiddenError('Rate management access is required.');
    }
    const id = assertUuid(rateId, 'Choose a valid rate.');
    const endsOn = parseEndRateInput(raw);

    const updated = await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-transport-rates-v1');
      const rate = await tx.findOne(TransportRate, { id });
      if (!rate) throw new NotFoundError('Transport rate not found.');
      if (endsOn < rate.startsOn) {
        throw new BadRequestError('End date cannot be earlier than start date.');
      }

      const overlaps = await rawQuery<{ id: string }>(
        tx,
        `SELECT id FROM app.transport_rates
         WHERE id <> $1::uuid
           AND "customerProductId" = $2::uuid
           AND "originId" IS NOT DISTINCT FROM $3::uuid
           AND "destinationId" IS NOT DISTINCT FROM $4::uuid
           AND "startsOn" <= $6::date
           AND COALESCE("endsOn", '9999-12-31'::date) >= $5::date
         LIMIT 1`,
        [
          rate.id,
          rate.customerProduct.id,
          rate.origin?.id ?? null,
          rate.destination?.id ?? null,
          rate.startsOn,
          endsOn,
        ],
      );
      if (overlaps.length > 0) {
        throw new ConflictError(
          'That end date overlaps another rate for this route.',
        );
      }

      rate.endsOn = endsOn;
      await tx.flush();
      return rate;
    });

    this.events.changed();
    return toRateDto(updated);
  }

  /**
   * Resolves the effective rate for a delivery on `operationalDate`.
   * An exact `(origin, destination)` route rate takes precedence over the default rate.
   */
  async resolveApplicableRate(
    em: EntityManager,
    customerProductId: string,
    originId: string | null,
    destinationId: string | null,
    operationalDate: string,
  ): Promise<TransportRate | null> {
    const matches = await rawQuery<{ id: string }>(
      em,
      `SELECT id FROM app.transport_rates
       WHERE "customerProductId" = $1::uuid
         AND "startsOn" <= $4::date
         AND ("endsOn" IS NULL OR "endsOn" >= $4::date)
         AND (
           ("originId" = $2::uuid AND "destinationId" = $3::uuid)
           OR ("originId" IS NULL AND "destinationId" IS NULL)
         )
       ORDER BY ("originId" IS NOT NULL) DESC, "startsOn" DESC
       LIMIT 1`,
      [customerProductId, originId, destinationId, operationalDate],
    );
    if (!matches[0]) return null;
    return em.findOne(TransportRate, { id: matches[0].id });
  }
}
