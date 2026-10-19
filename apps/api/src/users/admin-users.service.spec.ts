import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { KratosError, KratosService } from '../auth/kratos.service.js';
import { AdminUsersService, parseUserInput } from './admin-users.service.js';
import type { RbacService } from '../rbac/rbac.service.js';
import { User } from './user.entity.js';

describe('User provisioning', () => {
  const input = {
    email: 'new@example.test',
    firstName: 'New',
    lastName: 'Admin',
    password: 'Test-password-341!',
  };
  let users: {
    existsBy: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let kratos: {
    createIdentity: ReturnType<typeof vi.fn>;
    deleteIdentity: ReturnType<typeof vi.fn>;
  };
  let service: AdminUsersService;
  let database: { transaction: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    users = {
      existsBy: vi.fn().mockResolvedValue(false),
      create: vi.fn((v) => v),
      save: vi.fn((v) => Promise.resolve(v)),
    };
    kratos = {
      createIdentity: vi.fn().mockResolvedValue({ id: 'created-identity' }),
      deleteIdentity: vi.fn().mockResolvedValue(undefined),
    };
    database = {
      transaction: vi.fn(async (work) =>
        work({
          save: vi.fn((_entity, details) =>
            Promise.resolve({ ...details, id: 'user-id' }),
          ),
        }),
      ),
    };
    service = new AdminUsersService(
      users as unknown as Repository<User>,
      kratos as unknown as KratosService,
      database as unknown as DataSource,
      {} as RbacService,
    );
  });
  it('normalizes email and rejects privilege fields from clients', () => {
    expect(
      parseUserInput({ ...input, email: ' NEW@example.test ' }).email,
    ).toBe(input.email);
    expect(() => parseUserInput({ ...input, isActive: true })).toThrow(
      BadRequestException,
    );
    expect(() => parseUserInput({ ...input, password: 'short' })).toThrow(
      BadRequestException,
    );
  });
  it('creates an unverified identity and a linked local user without roles without persisting a password', async () => {
    const result = await service.create(input, { id: 'creator' } as User);
    expect(result).toMatchObject({
      kratosIdentityId: 'created-identity',
      createdById: 'creator',
    });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('userType');
    expect(result).not.toHaveProperty('roles');
    expect(kratos.createIdentity.mock.calls[0][0]).not.toHaveProperty(
      'verifiable_addresses',
    );
  });
  it('rejects local duplicates before touching Kratos', async () => {
    users.existsBy.mockResolvedValue(true);
    await expect(service.create(input, {} as User)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(kratos.createIdentity).not.toHaveBeenCalled();
  });
  it('rejects Kratos duplicates without persisting a local account', async () => {
    kratos.createIdentity.mockRejectedValue(new KratosError(409));
    await expect(service.create(input, {} as User)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(users.save).not.toHaveBeenCalled();
  });
  it('cleans up only the newly created identity when local persistence fails', async () => {
    users.save.mockRejectedValue(new Error('database unavailable'));
    await expect(service.create(input, {} as User)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(kratos.deleteIdentity).toHaveBeenCalledExactlyOnceWith(
      'created-identity',
    );
  });
  it('provisions related records in the same transaction and never grants roles', async () => {
    const provision = vi.fn().mockResolvedValue(undefined);
    const user = await service.create(
      input,
      { id: 'creator' } as User,
      provision,
    );
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(users.save).not.toHaveBeenCalled();
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({ save: expect.any(Function) }),
      user,
    );
    expect(user).not.toHaveProperty('password');
    expect(kratos.deleteIdentity).not.toHaveBeenCalled();
  });
  it('cleans up the new Kratos identity and preserves a profile conflict after rollback', async () => {
    const conflict = new ConflictException('Driver identifier already exists.');
    await expect(
      service.create(input, {} as User, async () => {
        throw conflict;
      }),
    ).rejects.toBe(conflict);
    expect(kratos.deleteIdentity).toHaveBeenCalledExactlyOnceWith(
      'created-identity',
    );
    expect(users.save).not.toHaveBeenCalled();
  });
});
