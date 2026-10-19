import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../users/user.entity.js';

@Entity({ name: 'permissions' })
export class Permission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100, unique: true }) key: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
}

@Entity({ name: 'roles' })
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 64, unique: true }) key: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @OneToMany(() => RolePermission, (grant) => grant.role)
  grants: Relation<RolePermission[]>;
}

@Entity({ name: 'role_permissions' })
export class RolePermission {
  @PrimaryColumn('uuid') roleId: string;
  @PrimaryColumn('uuid') permissionId: string;
  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role: Relation<Role>;
  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permissionId' })
  permission: Relation<Permission>;
}

@Entity({ name: 'user_roles' })
export class UserRole {
  @PrimaryColumn('uuid') userId: string;
  @PrimaryColumn('uuid') roleId: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;
  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role: Relation<Role>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
