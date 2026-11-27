import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';

export const User = defineEntity({
  name: 'User',
  tableName: 'users',
  schema: 'app',
  uniques: [{ name: 'uq_users_email', properties: ['email'] }],
  properties: {
    id: uuidPrimaryKey(),
    kratosIdentityId: p.uuid().unique(),
    email: p.string().length(320),
    firstName: p.string().length(100),
    lastName: p.string().length(100),
    isActive: p.boolean().default(true),
    createdBy: () =>
      p
        .manyToOne(User)
        .fieldName('createdById')
        .strictNullable()
        .deleteRule('set null'),
    lastLoginAt: p.datetime().columnType('timestamptz').strictNullable(),
    ...timestampColumns(),
  },
});

export type User = InferEntity<typeof User>;

export function userFullName(
  user: Pick<User, 'firstName' | 'lastName'>,
): string {
  return `${user.firstName} ${user.lastName}`;
}
