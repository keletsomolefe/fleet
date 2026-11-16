import { isActivePermission } from './active-permissions.js';
import { ForbiddenError } from '../http/errors.js';
import { Repository } from 'typeorm';
import { UserRole, Role } from './rbac.entity.js';

export interface Access {
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: string[];
}

export class RbacService {
  constructor(
    private readonly assignments: Repository<UserRole>,
    private readonly roles: Repository<Role>,
  ) {}

  async access(userId: string): Promise<Access> {
    const assigned = await this.assignments.find({
      where: { userId },
      relations: { role: { grants: { permission: true } } },
    });
    return {
      roles: assigned
        .map(({ role }) => ({ id: role.id, key: role.key, name: role.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      permissions: [
        ...new Set(
          assigned.flatMap(({ role }) =>
            role.grants.map((g) => g.permission.key).filter(isActivePermission),
          ),
        ),
      ].sort(),
    };
  }

  require(access: Access, ...permissions: string[]): void {
    if (
      !permissions.every(
        (key) => isActivePermission(key) && access.permissions.includes(key),
      )
    )
      throw new ForbiddenError(
        'You do not have permission to perform this action.',
      );
  }

  async catalog() {
    const roles = await this.roles.find({
      relations: { grants: { permission: true } },
      order: { name: 'ASC' },
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.grants
        .filter(({ permission }) => isActivePermission(permission.key))
        .map(({ permission }) => ({
          key: permission.key,
          name: permission.name,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }));
  }
}
