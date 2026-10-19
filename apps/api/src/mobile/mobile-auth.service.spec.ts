import { ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AuthService, type AdminContext } from '../auth/auth.service.js';
import { KratosService } from '../auth/kratos.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { MobileAuthService } from './mobile-auth.service.js';

describe('Unified native sign-in', () => {
  let service: MobileAuthService, context: AdminContext;
  const findOne = vi.fn(),
    findOneBy = vi.fn(),
    request = vi.fn(),
    revokeToken = vi.fn(),
    authenticateNative = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    context = {
      user: { id: 'user-id' },
      session: { id: 'session-id' },
      roles: [],
      permissions: ['driver.access'],
    } as unknown as AdminContext;
    findOne.mockResolvedValue(null);
    findOneBy.mockResolvedValue({ userId: context.user.id, status: 'active' });
    request
      .mockResolvedValueOnce({ id: 'flow-id' })
      .mockResolvedValueOnce({ session_token: 'native-session-token' });
    authenticateNative.mockImplementation(async () => context);
    revokeToken.mockResolvedValue(undefined);
    service = new MobileAuthService(
      {
        getRepository: () => ({ findOne, findOneBy }),
      } as unknown as DataSource,
      { request, revokeToken } as unknown as KratosService,
      {
        authenticateNative,
        profile: () => ({ id: 'user-id' }),
      } as unknown as AuthService,
      { require: RbacService.prototype.require } as RbacService,
    );
  });
  it('resolves an administrator from authenticated permissions without a selected role', async () => {
    context.permissions = ['admin.access', 'trucks.read', 'trucks.write'];
    await expect(
      service.login(
        { identifier: 'Admin@example.test', password: 'test-only' },
        'source',
      ),
    ).resolves.toMatchObject({ mode: 'setup' });
    expect(findOne).not.toHaveBeenCalled();
    expect(JSON.parse(request.mock.calls[1][1].body).identifier).toBe(
      'admin@example.test',
    );
  });
  it('resolves a Driver ID through Kratos and validates the authenticated user profile', async () => {
    findOne.mockResolvedValue({ user: { email: 'driver@example.test' } });
    await expect(
      service.login({ identifier: ' vh-01 ', password: 'test-only' }, 'source'),
    ).resolves.toMatchObject({ mode: 'driver' });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { identifier: 'VH-01' } }),
    );
    expect(JSON.parse(request.mock.calls[1][1].body).identifier).toBe(
      'driver@example.test',
    );
    expect(findOneBy).toHaveBeenCalledWith({
      userId: 'user-id',
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
  it('prefers device setup when an account has both sets of permissions', async () => {
    context.permissions.push('admin.access', 'trucks.read', 'trucks.write');
    await expect(service.resolveMode(context)).resolves.toBe('setup');
    context.permissions = ['driver.access', 'admin.access', 'trucks.read'];
    await expect(service.resolveMode(context)).resolves.toBe('driver');
  });
  it('revokes the newly issued session when no mobile workflow is permitted', async () => {
    context.permissions = ['trucks.read'];
    await expect(
      service.login(
        { identifier: 'user@example.test', password: 'test-only' },
        'source',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(revokeToken).toHaveBeenCalledWith('native-session-token');
  });
  it('rejects inactive or missing driver access even with valid Kratos credentials', async () => {
    findOneBy.mockResolvedValue(null);
    await expect(
      service.login(
        { identifier: 'driver@example.test', password: 'test-only' },
        'source',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(revokeToken).toHaveBeenCalledWith('native-session-token');
  });
  it('retains verification/session enforcement and revokes a denied login', async () => {
    authenticateNative.mockRejectedValue(
      new ForbiddenException('Verify your email.'),
    );
    await expect(
      service.login(
        { identifier: 'user@example.test', password: 'test-only' },
        'source',
      ),
    ).rejects.toThrow('Verify your email.');
    expect(revokeToken).toHaveBeenCalledWith('native-session-token');
  });
});
