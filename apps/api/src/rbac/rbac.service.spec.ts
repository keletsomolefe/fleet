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
