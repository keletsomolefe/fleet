import type { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestError, UnauthorizedError } from '../../../shared/errors.js';
import { User } from '../domain/user.entity.js';
import { syncKratosLogin } from './kratos-hook.plugin.js';

describe('Kratos after-login hook', () => {
  const event = {
    identity: {
      id: '4c39dcb2-80cf-4f34-90af-e2e2c50a6ed0',
      traits: {
        email: 'admin@example.test',
        name: { first: 'Admin', last: 'User' },
      },
    },
    authenticated_at: '2026-10-19T08:00:00Z',
  };
  let nativeUpdate: ReturnType<typeof vi.fn>;
  let em: Pick<EntityManager, 'nativeUpdate'>;

  beforeEach(() => {
    vi.stubEnv('KRATOS_HOOK_SECRET', 'hook-test-secret');
    nativeUpdate = vi.fn().mockResolvedValue(0);
    em = { nativeUpdate } as unknown as Pick<EntityManager, 'nativeUpdate'>;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects missing or incorrect hook authentication', async () => {
    await expect(
      syncKratosLogin(em, undefined, event),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(syncKratosLogin(em, 'wrong', event)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(nativeUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed authenticated events', async () => {
    await expect(
      syncKratosLogin(em, 'hook-test-secret', {}),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('only updates profile fields on existing users and ignores repeated or older events', async () => {
    await syncKratosLogin(em, 'hook-test-secret', event);
    expect(nativeUpdate).toHaveBeenCalledOnce();
    const [entity, where, data] = nativeUpdate.mock.calls[0];
    expect(entity).toBe(User);
    expect(where).toMatchObject({
      kratosIdentityId: event.identity.id,
      $or: [{ lastLoginAt: null }, { lastLoginAt: { $lt: expect.any(Date) } }],
    });
    expect(data).not.toHaveProperty('userType');
    expect(data).not.toHaveProperty('isActive');
  });

  it('keeps profile synchronization best effort during a database outage', async () => {
    nativeUpdate.mockRejectedValue(new Error('database unavailable'));
    await expect(
      syncKratosLogin(em, 'hook-test-secret', event),
    ).resolves.toBeUndefined();
  });
});
