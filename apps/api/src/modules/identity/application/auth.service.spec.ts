import type { MikroORM } from '@mikro-orm/postgresql';
import {
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../../shared/errors.js';
import type { User } from '../domain/user.entity.js';
import {
  KratosError,
  type KratosService,
  type KratosSession,
} from '../infrastructure/kratos.service.js';
import { AuthService, type AdminRequest } from './auth.service.js';
import { RbacService, type Access } from './rbac.service.js';

function fakeOrm(findOne: ReturnType<typeof vi.fn>): MikroORM {
  return { em: { fork: () => ({ findOne }) } } as unknown as MikroORM;
}

describe('Administrator sessions', () => {
  const user = {
    id: 'local-admin',
    kratosIdentityId: 'identity',
    isActive: true,
  } as User;
  const session = {
    id: 'session',
    active: true,
    identity: {
      id: 'identity',
      state: 'active',
      traits: {
        email: 'admin@example.test',
        name: { first: 'Admin', last: 'User' },
      },
      verifiable_addresses: [
        { value: 'admin@example.test', via: 'email', verified: true },
      ],
    },
  } as KratosSession;

  let whoami: ReturnType<typeof vi.fn>;
  let findOne: ReturnType<typeof vi.fn>;
  let auth: AuthService;
  let access: ReturnType<typeof vi.fn>;
  const grants = {
    roles: [{ id: 'owner-role', key: 'owner', name: 'Owner' }],
    permissions: ['admin.access'],
  };

  beforeEach(() => {
    whoami = vi.fn().mockResolvedValue(structuredClone(session));
    findOne = vi.fn().mockResolvedValue({ ...user });
    access = vi.fn().mockResolvedValue(grants);
    const rbac = new RbacService({} as MikroORM);
    auth = new AuthService(
      { whoami } as unknown as KratosService,
      fakeOrm(findOne),
      {
        access,
        require: (a: Access, ...p: string[]) => rbac.require(a, ...p),
      } as unknown as RbacService,
    );
    vi.stubEnv('APP_CSRF_SECRET', 'test-only-secret');
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3042/');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('requires a cookie and forwards it to Kratos', async () => {
    await expect(auth.authenticate()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(whoami).not.toHaveBeenCalled();
    await expect(
      auth.authenticate('fleet_kratos_session=opaque'),
    ).resolves.toMatchObject({ user: { id: user.id } });
    expect(whoami).toHaveBeenCalledWith('fleet_kratos_session=opaque');
  });

  it('rejects expired or revoked Kratos sessions', async () => {
    whoami.mockRejectedValue(new KratosError(401));
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('does not trust an inactive Kratos session', async () => {
    whoami.mockResolvedValue({ ...session, active: false });
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('requires the current email to be verified', async () => {
    const unverified = structuredClone(session);
    unverified.identity.verifiable_addresses = [];
    whoami.mockResolvedValue(unverified);
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it.each([null, { ...user, isActive: false }])(
    'denies users without active local admin access (%j)',
    async (local) => {
      findOne.mockResolvedValue(local);
      await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    },
  );

  it('uses permissions rather than a fixed user type', async () => {
    access.mockResolvedValue({
      roles: [{ key: 'driver' }],
      permissions: ['driver.access'],
    });
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    access.mockResolvedValue({
      roles: [{ key: 'driver' }, { key: 'administrator' }],
      permissions: ['driver.access', 'admin.access'],
    });
    await expect(auth.authenticate('cookie')).resolves.toMatchObject({
      permissions: ['driver.access', 'admin.access'],
    });
  });

  it('fails closed when the database or Kratos is unavailable', async () => {
    findOne.mockRejectedValue(new Error('connection failed'));
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    whoami.mockRejectedValue(new ServiceUnavailableError());
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it('fails closed when role resolution is unavailable', async () => {
    access.mockRejectedValue(new Error('permission lookup failed'));
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it('binds CSRF tokens to both the user and Kratos session', () => {
    const context = { user, session, ...grants };
    const token = auth.csrfToken(context);
    const request = (origin: string, value: string) =>
      ({
        adminContext: context,
        headers: { origin, 'x-csrf-token': value },
      }) satisfies AdminRequest;
    expect(() =>
      auth.verifyCsrf(request('http://127.0.0.1:3042', token)),
    ).not.toThrow();
    expect(() =>
      auth.verifyCsrf(request('http://evil.example', token)),
    ).toThrow(ForbiddenError);
    expect(() => auth.verifyCsrf(request('http://127.0.0.1:3042', ''))).toThrow(
      ForbiddenError,
    );
    expect(
      auth.csrfToken({
        user,
        ...grants,
        session: { ...session, id: 'another-session' },
      }),
    ).not.toBe(token);
  });
});

describe('Administrator-provisioned sign-in without email OTP', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('allows an unverified identity only when the explicit policy is off and local access remains active', async () => {
    vi.stubEnv('AUTH_REQUIRE_VERIFIED_EMAIL', 'false');
    const whoami = vi.fn().mockResolvedValue({
      id: 's',
      active: true,
      identity: {
        id: 'i',
        state: 'active',
        traits: { email: 'managed@example.test' },
        verifiable_addresses: [],
      },
    });
    const user = { id: 'u', isActive: true };
    const findOne = vi.fn().mockResolvedValue(user);
    const rbac = new RbacService({} as MikroORM);
    const auth = new AuthService(
      { whoami } as unknown as KratosService,
      fakeOrm(findOne),
      {
        access: vi
          .fn()
          .mockResolvedValue({ permissions: ['admin.access'], roles: [] }),
        require: (a: Access, ...p: string[]) => rbac.require(a, ...p),
      } as unknown as RbacService,
    );
    await expect(auth.authenticate('cookie')).resolves.toMatchObject({
      user: { id: 'u' },
    });
    findOne.mockResolvedValue(null);
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
