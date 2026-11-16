import { entityId } from '../database/database.js';
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import type { Rel } from '@mikro-orm/postgresql';

@Entity({ tableName: 'users', schema: 'app' })
export class User {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'uuid', unique: true })
  kratosIdentityId!: string;

  @Unique({ name: 'uq_users_email', properties: ['email'] })
  @Property({ type: 'string', length: 320 })
  email!: string;

  @Property({ type: 'string', length: 100 })
  firstName!: string;

  @Property({ type: 'string', length: 100 })
  lastName!: string;

  @Property({ type: 'boolean', default: true })
  isActive!: boolean;

  @ManyToOne(() => User, {
    fieldName: 'createdById',
    nullable: true,
    deleteRule: 'set null',
  })
  createdBy!: Rel<User> | null;

  get createdById(): string | null {
    return entityId(this.createdBy);
  }

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}
