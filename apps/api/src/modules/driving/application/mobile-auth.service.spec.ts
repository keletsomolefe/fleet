import type { MikroORM } from '@mikro-orm/postgresql';
import { ForbiddenError } from '../../../shared/errors.js';
import type {
  AdminContext,
  AuthService,
} from '../../identity/application/auth.service.js';
import {
  RbacService,
  type Access,
} from '../../identity/application/rbac.service.js';
import type { KratosService } from '../../identity/infrastructure/kratos.service.js';
import type { DrivingService } from './driving.service.js';
import { MobileAuthService } from './mobile-auth.service.js';

describe('Unified native sign-in', () => {
  let service: MobileAuthService;
  let context: AdminContext;
  const findOne = vi.fn();
  const request = vi.fn();
  const revokeToken = vi.fn();
  const authenticateNative = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    context = {
      user: { id: 'user-id' },
      session: { id: 'session-id' },
      roles: [],
      permissions: ['driver.access'],
    } as unknown as AdminContext;
    findOne.mockImplementation((_entity, where: Record<string, unknown>) => {
      if ('identifier' in where) return Promise.resolve(null);
      return Promise.resolve({ user: { id: context.user.id }, status: 'active' });
    });
    request
      .mockResolvedValueOnce({ id: 'flow-id' })
      .mockResolvedValueOnce({ session_token: 'native-session-token' });
    authenticateNative.mockImplementation(async () => context);
    revokeToken.mockResolvedValue(undefined);
    const rbac = new RbacService({} as MikroORM);
    service = new MobileAuthService(
      { em: { fork: () => ({ findOne }) } } as unknown as MikroORM,
      { request, revokeToken } as unknown as KratosService,
      {
        authenticateNative,
        profile: () => ({ id: 'user-id' }),
      } as unknown as AuthService,
      { require: (a: Access, ...p: string[]) => rbac.require(a, ...p) } as RbacService,
      { endForLogout: vi.fn() } as unknown as DrivingService,
    );
  });

  it('resolves an administrator from authenticated permissions without a selected role', async () => {
    context.permissions = ['admin.access', 'trucks.read', 'trucks.write'];
    await expect(
      service.login(
        { identifier: 'Admin@example.test', password: 'test-only' },
        'source',
      ),
    ).resolves.toMatchObject({ mode: 'admin' });
    expect(findOne).not.toHaveBeenCalled();
    expect(JSON.parse(request.mock.calls[1][1].body).identifier).toBe(
      'admin@example.test',
    );
  });

  it('opens the issue inbox for a mechanic without fleet-management permissions', async () => {
    context.permissions = ['admin.access', 'issues.read', 'issues.resolve'];
    await expect(service.resolveMode(context)).resolves.toBe('admin');
  });

  it('resolves a Driver ID through Kratos and validates the authenticated user profile', async () => {
    findOne.mockImplementation((_entity, where: Record<string, unknown>) => {
      if ('identifier' in where) {
        return Promise.resolve({ user: { email: 'driver@example.test' } });
      }
      return Promise.resolve({ user: { id: 'user-id' }, status: 'active' });
    });
    await expect(
      service.login({ identifier: ' vh-01 ', password: 'test-only' }, 'source'),
    ).resolves.toMatchObject({ mode: 'driver' });
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      { identifier: 'VH-01' },
      expect.objectContaining({ populate: ['user'] }),
    );
    expect(JSON.parse(request.mock.calls[1][1].body).identifier).toBe(
      'driver@example.test',
    );
    expect(findOne).toHaveBeenCalledWith(expect.anything(), {
      user: 'user-id',
      status: 'active',
    });
  });

  it('accepts a driver email and ignores a legacy attempt to select administrator access', async () => {
    await expect(
      service.login(
        {
          identifier: 'driver@example.test',
          password: 'test-only',
          mode: 'setup',
        },
        'source',
      ),
    ).resolves.toMatchObject({ mode: 'driver' });
  });

  it('opens driving when an account also has administrator permissions', async () => {
    context.permissions.push('admin.access', 'trucks.read', 'trucks.write');
    await expect(service.resolveMode(context)).resolves.toBe('driver');
    context.permissions = ['driver.access', 'admin.access', 'trucks.read'];
    await expect(service.resolveMode(context)).resolves.toBe('driver');
  });

  it('opens administration for an owner with driver permission but no driver profile', async () => {
    context.permissions.push('admin.access', 'trucks.read', 'trucks.write');
    findOne.mockResolvedValue(null);
    await expect(service.resolveMode(context)).resolves.toBe('admin');
  });

  it('revokes the newly issued session when no mobile workflow is permitted', async () => {
    context.permissions = ['trucks.read'];
    await expect(
      service.login(
        { identifier: 'user@example.test', password: 'test-only' },
        'source',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(revokeToken).toHaveBeenCalledWith('native-session-token');
  });

  it('rejects inactive or missing driver access even with valid Kratos credentials', async () => {
    findOne.mockResolvedValue(null);
    await expect(
      service.login(
        { identifier: 'driver@example.test', password: 'test-only' },
        'source',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(revokeToken).toHaveBeenCalledWith('native-session-token');
  });

  it('retains verification/session enforcement and revokes a denied login', async () => {
    authenticateNative.mockRejectedValue(
      new ForbiddenError('Verify your email.'),
    );
    await expect(
      service.login(
        { identifier: 'user@example.test', password: 'test-only' },
        'source',
      ),
    ).rejects.toThrow('Verify your email.');
    expect(revokeToken).toHaveBeenCalledWith('native-session-token');
  });

  it('allows Kratos logout even when application access has already ended', async () => {
    authenticateNative.mockRejectedValue(
      new ForbiddenError('Account is inactive.'),
    );
    await expect(
      service.logout('native-session-token'),
    ).resolves.toBeUndefined();
    expect(revokeToken).toHaveBeenCalledWith('native-session-token');
  });
});
