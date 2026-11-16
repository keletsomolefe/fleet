import { Repository } from '../database/database.js';
import { BadRequestError, UnauthorizedError } from '../http/errors.js';
import { User } from '../users/user.entity.js';
import { syncKratosLogin } from './kratos-hook.routes.js';

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
  let query: Record<string, ReturnType<typeof vi.fn>>;
  let users: Repository<User>;
  beforeEach(() => {
    vi.stubEnv('KRATOS_HOOK_SECRET', 'hook-test-secret');
    query = Object.fromEntries(
      ['update', 'set', 'where', 'andWhere', 'execute'].map((key) => [
        key,
        vi.fn(),
      ]),
    );
    for (const value of Object.values(query)) value.mockReturnValue(query);
    query.execute.mockResolvedValue({ affected: 0 });
    users = {
      createQueryBuilder: () => query,
    } as unknown as Repository<User>;
  });
  afterEach(() => vi.unstubAllEnvs());
  it('rejects missing or incorrect hook authentication', async () => {
    await expect(
      syncKratosLogin(users, undefined, event),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(syncKratosLogin(users, 'wrong', event)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(query.execute).not.toHaveBeenCalled();
  });
  it('rejects malformed authenticated events', async () => {
    await expect(
      syncKratosLogin(users, 'hook-test-secret', {}),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
  it('only updates profile fields on existing users and ignores repeated or older events', async () => {
    await syncKratosLogin(users, 'hook-test-secret', event);
    expect(query.set.mock.calls[0][0]).not.toHaveProperty('userType');
    expect(query.set.mock.calls[0][0]).not.toHaveProperty('isActive');
    expect(query.andWhere.mock.calls[0][0]).toContain('"lastLoginAt" < :at');
    expect(query.execute).toHaveBeenCalledOnce();
  });
  it('keeps profile synchronization best effort during a database outage', async () => {
    query.execute.mockRejectedValue(new Error('database unavailable'));
    await expect(
      syncKratosLogin(users, 'hook-test-secret', event),
    ).resolves.toBeUndefined();
  });
});
