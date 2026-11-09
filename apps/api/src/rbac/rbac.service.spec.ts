import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { RbacService } from './rbac.service.js';
import { Role, UserRole } from './rbac.entity.js';
import { parseAccessInput } from '../users/admin-users.service.js';

describe('Company user RBAC', () => {
  it('combines role permissions without duplicates, including driver and admin access', async () => {
    const assignment = (key: string, permissions: string[]) => ({
      role: {
        id: key,
        key,
        name: key,
        grants: permissions.map((key) => ({ permission: { key } })),
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
    const service = new RbacService(
      { find } as unknown as Repository<UserRole>,
      {} as Repository<Role>,
    );
    const access = await service.access('person');
    expect(access.permissions).toEqual([
      'admin.access',
      'driver.access',
      'users.read',
    ]);
    expect(access.roles.map((r) => r.key)).toEqual(['administrator', 'driver']);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'person' } }),
    );
    expect(() => service.require(access, 'users.read', 'users.access')).toThrow(
      ForbiddenException,
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
      grants: [
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
    };
    const service = new RbacService(
      {
        find: vi.fn().mockResolvedValue([{ role }]),
      } as unknown as Repository<UserRole>,
      {
        find: vi.fn().mockResolvedValue([role]),
      } as unknown as Repository<Role>,
    );
    expect((await service.access('person')).permissions).toEqual([
      'driver.access',
      'drivers.write',
      'trucks.write',
    ]);
    expect((await service.catalog())[0].permissions.map((p) => p.key)).toEqual([
      'driver.access',
      'drivers.write',
      'trucks.write',
    ]);
    for (const key of [
      'customers.write',
      'dispatch.write',
      'activities.write',
      'pricing.write',
      'revenue.read',
    ]) {
      expect(() =>
        service.require({ roles: [], permissions: [key] }, key),
      ).toThrow(ForbiddenException);
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
    ])
      expect(() => parseAccessInput(input)).toThrow();
  });
});
