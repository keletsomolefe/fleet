import type { EntityManager, FilterQuery, MikroORM } from '@mikro-orm/postgresql';
import {
  acquireAdvisoryLock,
  getEm,
  pgErrorCode,
  rawQuery,
} from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../../shared/errors.js';
import { escapeLikePattern } from '../../../shared/validation.js';
import { Role, UserRole } from '../domain/rbac.entity.js';
import { User } from '../domain/user.entity.js';
import {
  parseAccessInput,
  parseUserInput,
  parseUserSearch,
  toAdminUserSummaryDto,
} from '../http/user.dto.js';
import {
  KratosError,
  type KratosService,
} from '../infrastructure/kratos.service.js';
import type { RbacService } from './rbac.service.js';

export {
  parseAccessInput,
  parseUserInput,
  type CreateUserDto as CreateUserInput,
} from '../http/user.dto.js';

export class AdminUsersService {
  constructor(
    private readonly orm: MikroORM,
    private readonly kratos: KratosService,
    private readonly rbac: RbacService,
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  async create(
    raw: unknown,
    creator: User,
    provision?: (em: EntityManager, user: User) => Promise<void>,
  ): Promise<User> {
    const input = parseUserInput(raw);
    const em = getEm(this.orm);
    if ((await em.count(User, { email: input.email })) > 0) {
      throw new ConflictError('An account with this email already exists.');
    }

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
        if (error.status === 409) {
          throw new ConflictError('An account with this email already exists.');
        }
        throw new BadRequestError(
          'The identity service rejected these details. Check the email and use a stronger password.',
        );
      }
      throw error;
    }

    try {
      if (!provision) {
        const user = em.create(User, {
          kratosIdentityId: identity.id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          isActive: true,
          createdBy: em.getReference(User, creator.id),
        });
        await em.persist(user).flush();
        return user;
      }

      return await em.transactional(async (tx) => {
        const user = tx.create(User, {
          kratosIdentityId: identity.id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          isActive: true,
          createdBy: tx.getReference(User, creator.id),
        });
        await tx.persist(user).flush();
        await provision(tx, user);
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
      if (error instanceof HttpError) throw error;
      if (pgErrorCode(error) === '23505') {
        throw new ConflictError(
          'Account or driver details are already in use.',
        );
      }
      throw new ServiceUnavailableError(
        'The user could not be saved. Please try again.',
      );
    }
  }

  async list(rawQueryText = '', rawPage = '1') {
    const { query, page } = parseUserSearch(rawQueryText, rawPage);
    const em = getEm(this.orm);
    const where: FilterQuery<User> = query
      ? {
          $or: [
            { email: { $ilike: escapeLikePattern(query) } },
            { firstName: { $ilike: escapeLikePattern(query) } },
            { lastName: { $ilike: escapeLikePattern(query) } },
          ],
        }
      : {};

    const [users, total] = await em.findAndCount(User, where, {
      orderBy: { createdAt: 'desc', id: 'asc' },
      limit: 20,
      offset: (page - 1) * 20,
    });

    const assignments = users.length
      ? await em.find(
          UserRole,
          { user: { $in: users.map((user) => user.id) } },
          { populate: ['role'] },
        )
      : [];

    return {
      items: users.map((user) => ({
        ...toAdminUserSummaryDto(user),
        roles: assignments
          .filter((assignment) => assignment.user.id === user.id)
          .map(({ role }) => ({ id: role.id, key: role.key, name: role.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
      total,
      page,
      pageSize: 20,
    };
  }

  async get(id: string) {
    const em = getEm(this.orm);
    const user = await em.findOne(User, { id });
    if (!user) throw new NotFoundError('User not found.');
    return {
      ...toAdminUserSummaryDto(user),
      ...(await this.rbac.access(id, em)),
    };
  }

  async accountLink(actorId: string, targetId: string) {
    const em = getEm(this.orm);
    return em.transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-user-access-v1');
      const actor = await tx.findOne(User, { id: actorId });
      const actorRoles = await tx.find(
        UserRole,
        { user: actorId },
        { populate: ['role.grants.permission'] },
      );
      const permissions = new Set(
        actorRoles.flatMap(({ role }) =>
          role.grants.getItems().map((grant) => grant.permission.key),
        ),
      );
      if (
        !actor?.isActive ||
        !permissions.has('admin.access') ||
        !permissions.has('users.access')
      ) {
        throw new ForbiddenError('Account management access is required.');
      }

      const target = await tx.findOne(User, { id: targetId });
      if (!target) throw new NotFoundError('User not found.');
      if (!target.isActive) {
        throw new BadRequestError(
          'Activate the account before creating a setup link.',
        );
      }

      const roles = await tx.find(
        UserRole,
        { user: targetId },
        { populate: ['role'] },
      );
      if (
        roles.some((item) => item.role.key === 'owner') &&
        !permissions.has('users.owners')
      ) {
        throw new ForbiddenError(
          'You do not have permission to manage owners.',
        );
      }

      const result = await this.kratos.request<{
        recovery_link: string;
        expires_at: string;
      }>(
        'admin/recovery/link',
        {
          method: 'POST',
          body: JSON.stringify({
            identity_id: target.kratosIdentityId,
            expires_in: '30m',
          }),
        },
        true,
      );
      const link = new URL(result.recovery_link);
      const base = new URL(process.env.KRATOS_PUBLIC_URL!);
      if (
        link.origin !== base.origin ||
        !link.pathname.startsWith(base.pathname)
      ) {
        throw new ServiceUnavailableError(
          'The setup link could not be generated.',
        );
      }
      this.logger.info(
        `Account setup link created for user ${target.id} by ${actor.id}`,
      );
      return { url: link.toString(), expiresAt: result.expires_at };
    });
  }

  async setAccess(actorId: string, targetId: string, raw: unknown) {
    const input = parseAccessInput(raw);
    const em = getEm(this.orm);
    await em.transactional(async (tx) => {
      // Serialize access edits, including competing owner removals. Re-read the actor under this lock.
      await acquireAdvisoryLock(tx, 'fleet-user-access-v1');
      const actor = await tx.findOne(User, { id: actorId });
      const actorRoles = await tx.find(
        UserRole,
        { user: actorId },
        { populate: ['role.grants.permission'] },
      );
      const actorPermissions = new Set(
        actorRoles.flatMap(({ role }) =>
          role.grants.getItems().map((grant) => grant.permission.key),
        ),
      );
      if (
        !actor?.isActive ||
        !actorPermissions.has('admin.access') ||
        !actorPermissions.has('users.access')
      ) {
        throw new ForbiddenError(
          'You do not have permission to change user access.',
        );
      }

      const target = await tx.findOne(User, { id: targetId });
      if (!target) throw new NotFoundError('User not found.');

      const current = await tx.find(
        UserRole,
        { user: targetId },
        { populate: ['role'] },
      );
      const roles = input.roleIds.length
        ? await tx.find(Role, { id: { $in: input.roleIds } })
        : [];
      if (roles.length !== input.roleIds.length) {
        throw new BadRequestError('Select valid roles.');
      }

      const wasOwner = current.some(({ role }) => role.key === 'owner');
      const isOwner = roles.some((role) => role.key === 'owner');
      if ((wasOwner || isOwner) && !actorPermissions.has('users.owners')) {
        throw new ForbiddenError(
          'You do not have permission to manage owners.',
        );
      }
      if (wasOwner && (!isOwner || !input.isActive)) {
        const [remaining] = await rawQuery<{ count: number }>(
          tx,
          `SELECT count(*)::int AS count
           FROM app.user_roles ur
           JOIN app.users u ON u.id = ur."userId"
           JOIN app.roles r ON r.id = ur."roleId"
           WHERE r.key = 'owner' AND u."isActive" = true AND u.id <> $1`,
          [targetId],
        );
        if (!remaining.count) {
          throw new ConflictError('Keep at least one active owner.');
        }
      }

      const nextGrants = roles.length
        ? await rawQuery<{ key: string }>(
            tx,
            `SELECT p.key
             FROM app.role_permissions rp
             JOIN app.permissions p ON p.id = rp."permissionId"
             WHERE rp."roleId" = ANY($1::uuid[])`,
            [input.roleIds],
          )
        : [];
      if (
        actorId === targetId &&
        (!input.isActive ||
          !nextGrants.some((permission) => permission.key === 'admin.access'))
      ) {
        throw new ForbiddenError('You cannot remove your own admin access.');
      }

      await tx.nativeDelete(UserRole, { user: targetId });
      if (roles.length) {
        await tx.insertMany(
          UserRole,
          roles.map((role) => ({ user: targetId, role: role.id })),
        );
      }
      target.isActive = input.isActive;
      await tx.flush();
    });
    return this.get(targetId);
  }
}
