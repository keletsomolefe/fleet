import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { User } from './user.entity.js';

export const Permission = defineEntity({
  name: 'Permission',
  tableName: 'permissions',
  schema: 'app',
  properties: {
    id: uuidPrimaryKey(),
    key: p.string().length(100).unique(),
    name: p.string().length(100),
  },
});
export type Permission = InferEntity<typeof Permission>;

export const Role = defineEntity({
  name: 'Role',
  tableName: 'roles',
  schema: 'app',
  properties: {
    id: uuidPrimaryKey(),
    key: p.string().length(64).unique(),
    name: p.string().length(100),
    grants: () => p.oneToMany(RolePermission).mappedBy('role'),
  },
});
export type Role = InferEntity<typeof Role>;

export const RolePermission = defineEntity({
  name: 'RolePermission',
  tableName: 'role_permissions',
  schema: 'app',
  properties: {
    role: () =>
      p
        .manyToOne(Role)
        .fieldName('roleId')
        .primary()
        .deleteRule('cascade'),
    permission: () =>
      p
        .manyToOne(Permission)
        .fieldName('permissionId')
        .primary()
        .deleteRule('cascade'),
  },
});
export type RolePermission = InferEntity<typeof RolePermission>;

export const UserRole = defineEntity({
  name: 'UserRole',
  tableName: 'user_roles',
  schema: 'app',
  indexes: [{ name: 'idx_user_roles_role', properties: ['role'] }],
  properties: {
    user: () =>
      p
        .manyToOne(User)
        .fieldName('userId')
        .primary()
        .deleteRule('cascade'),
    role: () =>
      p
        .manyToOne(Role)
        .fieldName('roleId')
        .primary()
        .deleteRule('cascade'),
    createdAt: createdAtColumn(),
  },
});
export type UserRole = InferEntity<typeof UserRole>;
