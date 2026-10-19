import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { RbacService } from '../rbac/rbac.service.js';
import { User } from '../users/user.entity.js';
import { AuthService, type AdminRequest } from './auth.service.js';
import {
  KratosError,
  KratosService,
  type KratosSession,
} from './kratos.service.js';

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
  let findOneBy: ReturnType<typeof vi.fn>;
  let auth: AuthService;
  let access: ReturnType<typeof vi.fn>;
  const grants = {
    roles: [{ id: 'owner-role', key: 'owner', name: 'Owner' }],
    permissions: ['admin.access'],
  };
  beforeEach(() => {
    whoami = vi.fn().mockResolvedValue(structuredClone(session));
    findOneBy = vi.fn().mockResolvedValue({ ...user });
    access = vi.fn().mockResolvedValue(grants);
    auth = new AuthService(
      { whoami } as unknown as KratosService,
      { findOneBy } as unknown as Repository<User>,
      {
        access,
        require: RbacService.prototype.require,
      } as unknown as RbacService,
    );
    vi.stubEnv('APP_CSRF_SECRET', 'test-only-secret');
    vi.stubEnv('APP_URL', 'http://127.0.0.1:3042/');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('requires a cookie and forwards it to Kratos', async () => {
    await expect(auth.authenticate()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(whoami).not.toHaveBeenCalled();
    await expect(
      auth.authenticate('fleet_kratos_session=opaque'),
    ).resolves.toMatchObject({ user: { id: user.id } });
    expect(whoami).toHaveBeenCalledWith('fleet_kratos_session=opaque');
  });
  it('rejects expired or revoked Kratos sessions', async () => {
    whoami.mockRejectedValue(new KratosError(401));
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('does not trust an inactive Kratos session', async () => {
    whoami.mockResolvedValue({ ...session, active: false });
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('requires the current email to be verified', async () => {
    const unverified = structuredClone(session);
    unverified.identity.verifiable_addresses = [];
    whoami.mockResolvedValue(unverified);
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it.each([null, { ...user, isActive: false }])(
    'denies users without active local admin access (%j)',
    async (local) => {
      findOneBy.mockResolvedValue(local);
      await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );
  it('uses permissions rather than a fixed user type', async () => {
    access.mockResolvedValue({
      roles: [{ key: 'driver' }],
      permissions: ['driver.access'],
    });
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ForbiddenException,
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
    findOneBy.mockRejectedValue(new Error('connection failed'));
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    whoami.mockRejectedValue(new ServiceUnavailableException());
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('fails closed when role resolution is unavailable', async () => {
    access.mockRejectedValue(new Error('permission lookup failed'));
    await expect(auth.authenticate('cookie')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('binds CSRF tokens to both the user and Kratos session', () => {
    const context = { user, session, ...grants };
    const token = auth.csrfToken(context);
    const request = (origin: string, value: string) =>
      ({
        adminContext: context,
        get: (name: string) => (name === 'origin' ? origin : value),
      }) as AdminRequest;
    expect(() =>
      auth.verifyCsrf(request('http://127.0.0.1:3042', token)),
    ).not.toThrow();
    expect(() =>
      auth.verifyCsrf(request('http://evil.example', token)),
    ).toThrow(ForbiddenException);
    expect(() => auth.verifyCsrf(request('http://127.0.0.1:3042', ''))).toThrow(
      ForbiddenException,
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
