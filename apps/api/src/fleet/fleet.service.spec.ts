import { ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AdminUsersService } from '../users/admin-users.service.js';
import type { RbacService } from '../rbac/rbac.service.js';
import type { User } from '../users/user.entity.js';
import { FleetService } from './fleet.service.js';

describe('Driver onboarding authorization', () => {
  it('never provisions an identity when driver editors lack user creation permission', async () => {
    const create = vi.fn(),
      transaction = vi.fn();
    const fleet = new FleetService(
      { transaction } as unknown as DataSource,
      { create } as unknown as AdminUsersService,
      {} as RbacService,
    );
    await expect(
      fleet.saveDriver(
        {
          identifier: 'TEST',
          phone: '+27 82 000 0000',
          licenceNumber: 'TEST',
          licenceCode: 'EC',
          licenceCountry: 'ZA',
          licenceExpiresOn: '2099-01-01',
          status: 'active',
          account: { email: 'test@example.test' },
        },
        {} as User,
        undefined,
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
