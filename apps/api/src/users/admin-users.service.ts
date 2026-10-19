import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { KratosError, KratosService } from '../auth/kratos.service.js';
import { User } from './user.entity.js';
import { Role, UserRole } from '../rbac/rbac.entity.js';
import { RbacService } from '../rbac/rbac.service.js';

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

export function parseUserInput(value: unknown): CreateUserInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Enter the user details.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (k) => !['email', 'firstName', 'lastName', 'password'].includes(k),
    )
  )
    throw new BadRequestException('Unexpected account fields.');
  const email =
    typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const firstName =
    typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const lastName =
    typeof input.lastName === 'string' ? input.lastName.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
    throw new BadRequestException('Enter a valid email address.');
  if (
    !firstName ||
    !lastName ||
    firstName.length > 100 ||
    lastName.length > 100
  )
    throw new BadRequestException(
      'Enter first and last names of up to 100 characters.',
    );
  if (password.length < 8 || password.length > 128)
    throw new BadRequestException(
      'Use a password between 8 and 128 characters.',
    );
  return { email, firstName, lastName, password };
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(KratosService) private readonly kratos: KratosService,
    @Inject(DataSource) private readonly database: DataSource,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async create(
    raw: unknown,
    creator: User,
    provision?: (manager: EntityManager, user: User) => Promise<void>,
  ): Promise<User> {
    const input = parseUserInput(raw);
    if (await this.users.existsBy({ email: input.email }))
      throw new ConflictException('An account with this email already exists.');
    let identity;
    try {
      identity = await this.kratos.createIdentity({
        schema_id: 'fleet-user-v1',
        traits: {
          email: input.email,
          name: { first: input.firstName, last: input.lastName },
        },
        credentials: { password: { config: { password: input.password } } },
      });
    } catch (error) {
      if (error instanceof KratosError) {
        if (error.status === 409)
          throw new ConflictException(
            'An account with this email already exists.',
          );
        throw new BadRequestException(
          'The identity service rejected these details. Check the email and use a stronger password.',
        );
      }
      throw error;
    }
    try {
      const details = this.users.create({
        kratosIdentityId: identity.id,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        isActive: true,
        createdById: creator.id,
      });
      if (!provision) return await this.users.save(details);
      return await this.database.transaction(async (manager) => {
        const user = await manager.save(User, details);
        await provision(manager, user);
        return user;
      });
    } catch (error) {
      try {
        await this.kratos.deleteIdentity(identity.id);
      } catch {
        this.logger.error(
          `User provisioning cleanup required for identity ${identity.id}`,
        );
      }
      if (error instanceof HttpException) throw error;
      if ((error as { code?: string })?.code === '23505')
        throw new ConflictException(
          'Account or driver details are already in use.',
        );
      throw new ServiceUnavailableException(
        'The user could not be saved. Please try again.',
      );
    }
  }

  private profile(user: User) {
    return {
      id: user.id,
      identityId: user.kratosIdentityId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  async list(query = '', rawPage = '1') {
    if (
      typeof query !== 'string' ||
      query.length > 200 ||
      typeof rawPage !== 'string' ||
      !/^[1-9]\d{0,5}$/.test(rawPage)
    )
      throw new BadRequestException('Invalid user search.');
    const page = Number(rawPage);
    const builder = this.users
      .createQueryBuilder('u')
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'ASC');
    if (query.trim())
      builder.where(
        '(u.email ILIKE :search OR u.firstName ILIKE :search OR u.lastName ILIKE :search)',
        {
          search: `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`,
        },
      );
    const [users, total] = await builder
      .skip((page - 1) * 20)
      .take(20)
      .getManyAndCount();
    const assignments = users.length
      ? await this.database.getRepository(UserRole).find({
          where: { userId: In(users.map((user) => user.id)) },
          relations: { role: true },
        })
      : [];
    return {
      items: users.map((user) => ({
        ...this.profile(user),
        roles: assignments
          .filter((a) => a.userId === user.id)
          .map(({ role }) => ({ id: role.id, key: role.key, name: role.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
      total,
      page,
      pageSize: 20,
    };
  }

  async get(id: string) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found.');
    return { ...this.profile(user), ...(await this.rbac.access(id)) };
  }

  async setAccess(actorId: string, targetId: string, raw: unknown) {
    const input = parseAccessInput(raw);
    await this.database.transaction(async (manager) => {
      // Serialize access edits, including competing owner removals. Re-read the actor under this lock.
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-user-access-v1'))",
      );
      const actor = await manager.findOneBy(User, { id: actorId });
      const actorRoles = await manager.find(UserRole, {
        where: { userId: actorId },
        relations: { role: { grants: { permission: true } } },
      });
      const actorPermissions = new Set(
        actorRoles.flatMap(({ role }) =>
          role.grants.map((g) => g.permission.key),
        ),
      );
      if (
        !actor?.isActive ||
        !actorPermissions.has('admin.access') ||
        !actorPermissions.has('users.access')
      )
        throw new ForbiddenException(
          'You do not have permission to change user access.',
        );
      const target = await manager.findOneBy(User, { id: targetId });
      if (!target) throw new NotFoundException('User not found.');
      const current = await manager.find(UserRole, {
        where: { userId: targetId },
        relations: { role: true },
      });
      const roles = input.roleIds.length
        ? await manager.findBy(Role, { id: In(input.roleIds) })
        : [];
      if (roles.length !== input.roleIds.length)
        throw new BadRequestException('Select valid roles.');
      const wasOwner = current.some(({ role }) => role.key === 'owner');
      const isOwner = roles.some((role) => role.key === 'owner');
      if ((wasOwner || isOwner) && !actorPermissions.has('users.owners'))
        throw new ForbiddenException(
          'You do not have permission to manage owners.',
        );
      if (wasOwner && (!isOwner || !input.isActive)) {
        const [remaining] = await manager.query(
          `SELECT count(*)::int AS count FROM app.user_roles ur
          JOIN app.users u ON u.id=ur."userId" JOIN app.roles r ON r.id=ur."roleId"
          WHERE r.key='owner' AND u."isActive"=true AND u.id<>$1`,
          [targetId],
        );
        if (!remaining.count)
          throw new ConflictException('Keep at least one active owner.');
      }
      const nextGrants = roles.length
        ? await manager.query(
            `SELECT p.key FROM app.role_permissions rp
        JOIN app.permissions p ON p.id=rp."permissionId" WHERE rp."roleId"=ANY($1::uuid[])`,
            [input.roleIds],
          )
        : [];
      if (
        actorId === targetId &&
        (!input.isActive ||
          !nextGrants.some((p: { key: string }) => p.key === 'admin.access'))
      )
        throw new ForbiddenException(
          'You cannot remove your own admin access.',
        );
      await manager.delete(UserRole, { userId: targetId });
      if (roles.length)
        await manager.insert(
          UserRole,
          roles.map((role) => ({ userId: targetId, roleId: role.id })),
        );
      await manager.update(
        User,
        { id: targetId },
        { isActive: input.isActive },
      );
    });
    return this.get(targetId);
  }
}

export function parseAccessInput(raw: unknown): {
  roleIds: string[];
  isActive: boolean;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('Invalid access details.');
  const input = raw as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !['roleIds', 'isActive'].includes(key)) ||
    typeof input.isActive !== 'boolean' ||
    !Array.isArray(input.roleIds) ||
    input.roleIds.length > 20 ||
    input.roleIds.some(
      (id) =>
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    throw new BadRequestException('Select valid roles and account status.');
  return {
    roleIds: [...new Set(input.roleIds as string[])],
    isActive: input.isActive,
  };
}
