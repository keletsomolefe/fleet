import type { MikroORM } from '@mikro-orm/postgresql';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
} from '../../../shared/errors.js';
import type { User } from '../domain/user.entity.js';
import {
  KratosError,
  type KratosService,
} from '../infrastructure/kratos.service.js';
import { AdminUsersService, parseUserInput } from './admin-users.service.js';
import type { RbacService } from './rbac.service.js';

function collection<T>(items: T[]) {
  return { getItems: () => items };
}

describe('User provisioning', () => {
  const input = {
    email: 'new@example.test',
    firstName: 'New',
    lastName: 'Admin',
    password: 'Test-password-341!',
  };
  let em: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    getReference: ReturnType<typeof vi.fn>;
    persist: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    transactional: ReturnType<typeof vi.fn>;
  };
  let kratos: {
    createIdentity: ReturnType<typeof vi.fn>;
    deleteIdentity: ReturnType<typeof vi.fn>;
  };
  let service: AdminUsersService;

  beforeEach(() => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn((_entity, data) => ({ ...data, id: 'user-id' }));
    const getReference = vi.fn((_entity, id) => ({ id }));
    const persist = vi.fn(() => ({ flush }));

    em = {
      count: vi.fn().mockResolvedValue(0),
      create,
      getReference,
      persist,
      flush,
      transactional: vi.fn(async (work) =>
        work({
          create,
          getReference,
          persist,
          flush,
        }),
      ),
    };
    kratos = {
      createIdentity: vi.fn().mockResolvedValue({ id: 'created-identity' }),
      deleteIdentity: vi.fn().mockResolvedValue(undefined),
    };
    service = new AdminUsersService(
      { em: { fork: () => em } } as unknown as MikroORM,
      kratos as unknown as KratosService,
      {} as RbacService,
    );
  });

  it('normalizes email and rejects privilege fields from clients', () => {
    expect(
      parseUserInput({ ...input, email: ' NEW@example.test ' }).email,
    ).toBe(input.email);
    expect(() => parseUserInput({ ...input, isActive: true })).toThrow(
      BadRequestError,
    );
    expect(() => parseUserInput({ ...input, password: 'short' })).toThrow(
      BadRequestError,
    );
  });

  it('creates an unverified identity and a linked local user without roles without persisting a password', async () => {
    const result = await service.create(input, { id: 'creator' } as User);
    expect(result).toMatchObject({
      kratosIdentityId: 'created-identity',
      createdBy: { id: 'creator' },
    });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('userType');
    expect(result).not.toHaveProperty('roles');
    expect(kratos.createIdentity.mock.calls[0][0]).not.toHaveProperty(
      'verifiable_addresses',
    );
  });

  it('rejects local duplicates before touching Kratos', async () => {
    em.count.mockResolvedValue(1);
    await expect(service.create(input, {} as User)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(kratos.createIdentity).not.toHaveBeenCalled();
  });

  it('rejects Kratos duplicates without persisting a local account', async () => {
    kratos.createIdentity.mockRejectedValue(new KratosError(409));
    await expect(service.create(input, {} as User)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('cleans up only the newly created identity when local persistence fails', async () => {
    em.flush.mockRejectedValue(new Error('database unavailable'));
    await expect(service.create(input, {} as User)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
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
    expect(em.transactional).toHaveBeenCalledOnce();
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({ persist: expect.any(Function) }),
      user,
    );
    expect(user).not.toHaveProperty('password');
    expect(kratos.deleteIdentity).not.toHaveBeenCalled();
  });

  it('cleans up the new Kratos identity and preserves a profile conflict after rollback', async () => {
    const conflict = new ConflictError('Driver identifier already exists.');
    await expect(
      service.create(input, {} as User, async () => {
        throw conflict;
      }),
    ).rejects.toBe(conflict);
    expect(kratos.deleteIdentity).toHaveBeenCalledExactlyOnceWith(
      'created-identity',
    );
  });
});

describe('Administrator setup links', () => {
  afterEach(() => vi.unstubAllEnvs());

  function fixture(permissionKeys: string[], owner = false, active = true) {
    const actor = { id: 'actor', isActive: true };
    const target = { id: 'target', isActive: active, kratosIdentityId: 'identity' };
    const tx = {
      execute: vi.fn(),
      findOne: vi.fn((_entity, where) =>
        Promise.resolve(where.id === 'actor' ? actor : target),
      ),
      find: vi.fn((_entity, where) =>
        Promise.resolve(
          where.user === 'actor'
            ? [
                {
                  role: {
                    grants: collection(
                      permissionKeys.map((key) => ({ permission: { key } })),
                    ),
                  },
                },
              ]
            : owner
              ? [{ role: { key: 'owner' } }]
              : [],
        ),
      ),
    };
    const request = vi.fn().mockResolvedValue({
      recovery_link:
        'https://fleet.example/auth/self-service/recovery?token=secret',
      expires_at: '2026-10-26T13:30:00Z',
    });
    vi.stubEnv('KRATOS_PUBLIC_URL', 'https://fleet.example/auth/');
    const service = new AdminUsersService(
      {
        em: { fork: () => ({ transactional: vi.fn((work) => work(tx)) }) },
      } as unknown as MikroORM,
      { request } as unknown as KratosService,
      {} as RbacService,
    );
    return { service, request };
  }

  it('prevents administrators without owner-management permission from resetting owner credentials', async () => {
    const { service, request } = fixture(
      ['admin.access', 'users.access'],
      true,
    );
    await expect(service.accountLink('actor', 'target')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('requires account management permission and an active target', async () => {
    for (const [grants, active] of [
      [['admin.access'], true],
      [['admin.access', 'users.access'], false],
    ] as const) {
      const { service, request } = fixture([...grants], false, active);
      await expect(service.accountLink('actor', 'target')).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    }
  });

  it('creates a bounded Kratos link without changing roles or storing a password', async () => {
    const { service, request } = fixture(
      ['admin.access', 'users.access', 'users.owners'],
      true,
    );
    const result = await service.accountLink('actor', 'target');
    expect(result.url).toContain('https://fleet.example/auth/');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      identity_id: 'identity',
      expires_in: '30m',
    });
  });
});
