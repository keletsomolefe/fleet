import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { getEm } from '../../../database/context.js';
import { ForbiddenError } from '../../../shared/errors.js';
import { isActivePermission } from '../domain/permissions.js';
import { Role, UserRole } from '../domain/rbac.entity.js';

export interface Access {
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: string[];
}

export class RbacService {
  constructor(private readonly orm: MikroORM) {}

  async access(userId: string, em: EntityManager = getEm(this.orm)): Promise<Access> {
    const assigned = await em.find(
      UserRole,
      { user: userId },
      { populate: ['role.grants.permission'] },
    );
    return {
      roles: assigned
        .map(({ role }) => ({ id: role.id, key: role.key, name: role.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      permissions: [
        ...new Set(
          assigned.flatMap(({ role }) =>
            role.grants
              .getItems()
              .map((grant) => grant.permission.key)
              .filter(isActivePermission),
          ),
        ),
      ].sort(),
    };
  }

  require(this: void, access: Access, ...permissions: string[]): void {
    if (
      !permissions.every(
        (key) => isActivePermission(key) && access.permissions.includes(key),
      )
    ) {
      throw new ForbiddenError(
        'You do not have permission to perform this action.',
      );
    }
  }

  async catalog() {
    const em = getEm(this.orm);
    const roles = await em.find(
      Role,
      {},
      { populate: ['grants.permission'], orderBy: { name: 'asc' } },
    );
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.grants
        .getItems()
        .filter(({ permission }) => isActivePermission(permission.key))
        .map(({ permission }) => ({
          key: permission.key,
          name: permission.name,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }));
  }
}
