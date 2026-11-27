import type { MikroORM } from '@mikro-orm/postgresql';
import { ForbiddenError } from '../../../shared/errors.js';
import type { AdminUsersService } from '../../identity/application/admin-users.service.js';
import type { RbacService } from '../../identity/application/rbac.service.js';
import type { User } from '../../identity/domain/user.entity.js';
import { FleetService } from './fleet.service.js';

describe('Driver onboarding authorization', () => {
  it('never provisions an identity when driver editors lack user creation permission', async () => {
    const create = vi.fn();
    const transactional = vi.fn();
    const fleet = new FleetService(
      { em: { fork: () => ({ transactional }) } } as unknown as MikroORM,
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
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(create).not.toHaveBeenCalled();
    expect(transactional).not.toHaveBeenCalled();
  });
});
