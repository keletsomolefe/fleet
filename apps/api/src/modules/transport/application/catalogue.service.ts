import type { MikroORM } from '@mikro-orm/postgresql';
import { getEm, pgErrorCode, rawQuery } from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { userFullName } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import {
  Customer,
  CustomerProduct,
  Location,
  Product,
} from '../domain/catalogue.entity.js';
import { unitKeys } from '../domain/pricing.js';
import {
  parseCustomerInput,
  parseCustomerProductInput,
  parseLocationInput,
  parseProductInput,
  toCustomerDto,
  toCustomerProductDto,
  toLocationDto,
  toProductDto,
} from '../http/transport.dto.js';

export type MasterKind =
  | 'customers'
  | 'locations'
  | 'products'
  | 'customer-products';

const writePermissionByKind: Record<MasterKind, string> = {
  customers: 'customers.write',
  locations: 'locations.write',
  products: 'products.write',
  'customer-products': 'customers.write',
};

const readCataloguePermissions = [
  'customers.read',
  'locations.read',
  'products.read',
  'pricing.read',
  'dispatch.read',
  'activities.read',
  'revenue.read',
  'expenses.read',
  'shifts.read',
];

export class CatalogueService {
  constructor(
    private readonly orm: MikroORM,
    private readonly events: OperationsEventsService,
  ) {}

  private assertCanRead(context: AdminContext, mobile: boolean): void {
    if (mobile) {
      if (!context.permissions.includes('driver.access')) {
        throw new ForbiddenError('Driver access is not enabled.');
      }
      return;
    }
    if (
      !readCataloguePermissions.some((permission) =>
        context.permissions.includes(permission),
      )
    ) {
      throw new ForbiddenError('Catalogue access is required.');
    }
  }

  async catalogue(context: AdminContext, mobile = false) {
    this.assertCanRead(context, mobile);
    const em = getEm(this.orm);
    const activeFilter = mobile ? { active: true } : {};

    const [customers, locations, products, customerProducts, trucks, drivers] =
      await Promise.all([
        em.find(Customer, activeFilter, { orderBy: { name: 'asc' } }),
        em.find(Location, activeFilter, { orderBy: { name: 'asc' } }),
        em.find(Product, activeFilter, { orderBy: { name: 'asc' } }),
        em.find(CustomerProduct, activeFilter, { orderBy: { id: 'asc' } }),
        mobile
          ? Promise.resolve([])
          : em.find(Truck, {}, { orderBy: { identifier: 'asc' } }),
        mobile
          ? Promise.resolve([])
          : em.find(
              DriverProfile,
              {},
              { populate: ['user'], orderBy: { identifier: 'asc' } },
            ),
      ]);

    return {
      customers: customers.map(toCustomerDto),
      locations: locations.map(toLocationDto),
      products: products.map(toProductDto),
      customerProducts: customerProducts.map(toCustomerProductDto),
      units: [...unitKeys],
      ...(!mobile
        ? {
            trucks: trucks.map((t) => ({
              id: t.id,
              identifier: t.identifier,
              registration: t.registration,
              status: t.status,
              odometerKm: t.odometerKm,
            })),
            drivers: drivers.map((d) => ({
              id: d.id,
              identifier: d.identifier,
              name: userFullName(d.user),
              status: d.status,
            })),
          }
        : {}),
    };
  }

  async saveMaster(
    context: AdminContext,
    rawKind: string,
    rawBody: unknown,
    rawId?: string,
  ) {
    if (!(rawKind in writePermissionByKind)) {
      throw new BadRequestError('Unknown catalogue type.');
    }
    const kind = rawKind as MasterKind;
    const permission = writePermissionByKind[kind];
    if (!context.permissions.includes(permission)) {
      throw new ForbiddenError('You do not have permission to edit this.');
    }
    const id = rawId ? assertUuid(rawId, 'Choose a valid record.') : undefined;

    try {
      const result = await getEm(this.orm).transactional(async (tx) => {
        if (kind === 'customers') {
          const input = parseCustomerInput(rawBody);
          const duplicate = await rawQuery<{ id: string }>(
            tx,
            `SELECT id FROM app.customers WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
            [input.name, id ?? null],
          );
          if (duplicate.length) {
            throw new ConflictError('A customer with that name already exists.');
          }
          if (id) {
            const customer = await tx.findOne(Customer, { id });
            if (!customer) throw new NotFoundError('Customer not found.');
            if (input.version !== null && customer.version !== input.version) {
              throw new ConflictError(
                'This customer changed. Refresh and try again.',
              );
            }
            customer.name = input.name;
            customer.industry = input.industry;
            customer.contact = input.contact;
            customer.email = input.email;
            customer.phone = input.phone;
            customer.notes = input.notes;
            customer.active = input.active;
            customer.version += 1;
            await tx.flush();
            return toCustomerDto(customer);
          }
          const created = tx.create(Customer, {
            name: input.name,
            industry: input.industry,
            contact: input.contact,
            email: input.email,
            phone: input.phone,
            notes: input.notes,
            active: input.active,
            version: 1,
          });
          await tx.persist(created).flush();
          return toCustomerDto(created);
        }

        if (kind === 'locations') {
          const input = parseLocationInput(rawBody);
          if (input.customerIds.length > 0) {
            const found = await tx.count(Customer, {
              id: { $in: input.customerIds },
            });
            if (found !== input.customerIds.length) {
              throw new BadRequestError(
                'Choose valid customers for this location.',
              );
            }
          }
          if (id) {
            const location = await tx.findOne(Location, { id });
            if (!location) throw new NotFoundError('Location not found.');
            if (input.version !== null && location.version !== input.version) {
              throw new ConflictError(
                'This location changed. Refresh and try again.',
              );
            }
            location.name = input.name;
            location.siteType = input.siteType;
            location.directions = input.directions;
            location.contact = input.contact;
            location.phone = input.phone;
            location.customerIds = input.customerIds;
            location.latitude = input.latitude;
            location.longitude = input.longitude;
            location.active = input.active;
            location.version += 1;
            await tx.flush();
            return toLocationDto(location);
          }
          const created = tx.create(Location, {
            name: input.name,
            siteType: input.siteType,
            directions: input.directions,
            contact: input.contact,
            phone: input.phone,
            customerIds: input.customerIds,
            latitude: input.latitude,
            longitude: input.longitude,
            active: input.active,
            version: 1,
          });
          await tx.persist(created).flush();
          return toLocationDto(created);
        }

        if (kind === 'products') {
          const input = parseProductInput(rawBody);
          const duplicate = await rawQuery<{ id: string }>(
            tx,
            `SELECT id FROM app.products WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
            [input.name, id ?? null],
          );
          if (duplicate.length) {
            throw new ConflictError('A product with that name already exists.');
          }
          if (id) {
            const product = await tx.findOne(Product, { id });
            if (!product) throw new NotFoundError('Product not found.');
            if (input.version !== null && product.version !== input.version) {
              throw new ConflictError(
                'This product changed. Refresh and try again.',
              );
            }
            product.name = input.name;
            product.unit = input.unit;
            product.active = input.active;
            product.version += 1;
            await tx.flush();
            return toProductDto(product);
          }
          const created = tx.create(Product, {
            name: input.name,
            unit: input.unit,
            active: input.active,
            version: 1,
          });
          await tx.persist(created).flush();
          return toProductDto(created);
        }

        // customer-products
        const input = parseCustomerProductInput(rawBody);
        const [customer, product] = await Promise.all([
          tx.findOne(Customer, { id: input.customerId }),
          tx.findOne(Product, { id: input.productId }),
        ]);
        if (!customer || !product) {
          throw new BadRequestError('Choose a valid customer and product.');
        }
        if (id) {
          const cp = await tx.findOne(CustomerProduct, { id });
          if (!cp) {
            throw new NotFoundError('Customer product link not found.');
          }
          if (input.version !== null && cp.version !== input.version) {
            throw new ConflictError('This record changed. Refresh and try again.');
          }
          cp.supplies = input.supplies;
          cp.receives = input.receives;
          cp.active = input.active;
          cp.version += 1;
          await tx.flush();
          return toCustomerProductDto(cp);
        }
        const existing = await tx.findOne(CustomerProduct, {
          customer: customer.id,
          product: product.id,
        });
        if (existing) {
          existing.supplies = input.supplies;
          existing.receives = input.receives;
          existing.active = input.active;
          existing.version += 1;
          await tx.flush();
          return toCustomerProductDto(existing);
        }
        const created = tx.create(CustomerProduct, {
          customer,
          product,
          supplies: input.supplies,
          receives: input.receives,
          active: input.active,
          version: 1,
        });
        await tx.persist(created).flush();
        return toCustomerProductDto(created);
      });

      this.events.changed();
      return result;
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        throw new ConflictError('A record with those details already exists.');
      }
      throw error;
    }
  }
}
