import {
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import type { Collection, Rel } from '@mikro-orm/postgresql';
import { User } from '../users/user.entity.js';

@Entity({ tableName: 'permissions', schema: 'app' })
export class Permission {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 100, unique: true })
  key!: string;

  @Property({ type: 'string', length: 100 })
  name!: string;
}

@Entity({ tableName: 'roles', schema: 'app' })
export class Role {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 64, unique: true })
  key!: string;

  @Property({ type: 'string', length: 100 })
  name!: string;

  @OneToMany(() => RolePermission, (grant) => grant.role)
  grants = [] as unknown as Collection<RolePermission>;
}

@Entity({ tableName: 'role_permissions', schema: 'app' })
export class RolePermission {
  @ManyToOne(() => Role, {
    fieldName: 'roleId',
    primary: true,
    deleteRule: 'cascade',
  })
  role!: Rel<Role>;

  @ManyToOne(() => Permission, {
    fieldName: 'permissionId',
    primary: true,
    deleteRule: 'cascade',
  })
  permission!: Rel<Permission>;
}

@Entity({ tableName: 'user_roles', schema: 'app' })
@Index({ name: 'idx_user_roles_role', properties: ['role'] })
export class UserRole {
  @ManyToOne(() => User, {
    fieldName: 'userId',
    primary: true,
    deleteRule: 'cascade',
  })
  user!: Rel<User>;

  @ManyToOne(() => Role, {
    fieldName: 'roleId',
    primary: true,
    deleteRule: 'cascade',
  })
  role!: Rel<Role>;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;
}
