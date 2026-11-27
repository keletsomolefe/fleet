import type { MikroORM } from '@mikro-orm/postgresql';
import { ForbiddenError } from '../../../shared/errors.js';
import { parseAccessInput } from '../http/user.dto.js';
import { RbacService } from './rbac.service.js';

function collection<T>(items: T[]) {
  return { getItems: () => items };
}

describe('Company user RBAC', () => {
  it('combines role permissions without duplicates, including driver and admin access', async () => {
    const assignment = (key: string, permissions: string[]) => ({
      role: {
        id: key,
        key,
        name: key,
        grants: collection(permissions.map((perm) => ({ permission: { key: perm } }))),
      },
    });
    const find = vi
      .fn()
      .mockResolvedValue([
        assignment('driver', ['driver.access']),
        assignment('administrator', [
          'admin.access',
          'users.read',
          'driver.access',
        ]),
      ]);
    const service = new RbacService({
      em: { fork: () => ({ find }) },
    } as unknown as MikroORM);
    const access = await service.access('person');
    expect(access.permissions).toEqual([
      'admin.access',
      'driver.access',
      'users.read',
    ]);
    expect(access.roles.map((r) => r.key)).toEqual(['administrator', 'driver']);
    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      { user: 'person' },
      expect.objectContaining({ populate: ['role.grants.permission'] }),
    );
    expect(() => service.require(access, 'users.read', 'users.access')).toThrow(
      ForbiddenError,
    );
    expect(() => service.require(access, 'admin.access')).not.toThrow();
    find.mockResolvedValue([]);
    expect((await service.access('new-user')).permissions).toEqual([]);
  });

  it('excludes retired feature grants from sessions and the role catalogue', async () => {
    const role = {
      id: 'owner',
      key: 'owner',
      name: 'Owner',
      grants: collection(
        [
          'driver.access',
          'drivers.write',
          'trucks.write',
          'customers.read',
          'customers.write',
          'locations.read',
          'locations.write',
          'dispatch.read',
          'dispatch.write',
          'activities.read',
          'activities.write',
          'activities.review',
          'revenue.read',
          'exceptions.read',
          'exports.read',
          'vehicle_reports.read',
          'shifts.read',
          'products.read',
          'products.write',
          'pricing.read',
          'pricing.write',
        ].map((key) => ({ permission: { key, name: key } })),
      ),
    };
    const find = vi.fn((_entity, where) =>
      Promise.resolve('user' in (where as object) ? [{ role }] : [role]),
    );
    const service = new RbacService({
      em: { fork: () => ({ find }) },
    } as unknown as MikroORM);

    expect((await service.access('person')).permissions).toEqual([
      'activities.read',
      'activities.review',
      'activities.write',
      'customers.read',
      'customers.write',
      'dispatch.read',
      'dispatch.write',
      'driver.access',
      'drivers.write',
      'locations.read',
      'locations.write',
      'pricing.read',
      'pricing.write',
      'products.read',
      'products.write',
      'revenue.read',
      'shifts.read',
      'trucks.write',
    ]);
    expect((await service.catalog())[0].permissions.map((p) => p.key)).toEqual([
      'activities.read',
      'activities.review',
      'activities.write',
      'customers.read',
      'customers.write',
      'dispatch.read',
      'dispatch.write',
      'driver.access',
      'drivers.write',
      'locations.read',
      'locations.write',
      'pricing.read',
      'pricing.write',
      'products.read',
      'products.write',
      'revenue.read',
      'shifts.read',
      'trucks.write',
    ]);
    for (const key of ['exceptions.read', 'exports.read', 'vehicle_reports.read']) {
      expect(() =>
        service.require({ roles: [], permissions: [key] }, key),
      ).toThrow(ForbiddenError);
    }
  });

  it('validates access updates and refuses client permission or user-type fields', () => {
    const role = '00000000-0000-0000-0000-000000000001';
    expect(parseAccessInput({ roleIds: [role, role], isActive: true })).toEqual(
      { roleIds: [role], isActive: true },
    );
    for (const input of [
      null,
      { roleIds: [], isActive: 'true' },
      { roleIds: ['invalid'], isActive: true },
      { roleIds: [], isActive: true, permissions: ['users.owners'] },
      { roleIds: [], isActive: true, userType: 'admin' },
    ]) {
      expect(() => parseAccessInput(input)).toThrow();
    }
  });
});
