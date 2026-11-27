import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { createdAtColumn } from '../../../shared/entity-columns.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';

export const issueCategories = ['vehicle', 'safety', 'other'] as const;
export type IssueCategory = (typeof issueCategories)[number];

const categorySql = issueCategories.map((v) => `'${v}'`).join(', ');

export const DriverIssue = defineEntity({
  name: 'DriverIssue',
  tableName: 'driver_issues',
  schema: 'app',
  indexes: [
    {
      name: 'ix_driver_issues_driver',
      properties: ['driver', 'createdAt'],
    },
    {
      name: 'ix_driver_issues_open',
      properties: ['createdAt', 'id'],
      where: '"resolvedAt" IS NULL',
    },
  ],
  checks: [
    {
      name: 'driver_issues_category_check',
      expression: `category IN (${categorySql})`,
    },
  ],
  properties: {
    /** Client-generated UUID used as an idempotency key for offline mobile retries. */
    id: p.uuid().primary(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    truck: () =>
      p
        .manyToOne(Truck)
        .fieldName('truckId')
        .strictNullable()
        .deleteRule('restrict'),
    category: p.string().length(24).$type<IssueCategory>(),
    description: p.text(),
    createdAt: createdAtColumn(),
    resolvedAt: p.datetime().columnType('timestamptz').strictNullable(),
    resolvedBy: () =>
      p
        .manyToOne(User)
        .fieldName('resolvedById')
        .strictNullable()
        .deleteRule('restrict'),
    resolutionNote: p.text().strictNullable(),
  },
});

export type DriverIssue = InferEntity<typeof DriverIssue>;

export function isIssueResolved(issue: Pick<DriverIssue, 'resolvedAt'>): boolean {
  return issue.resolvedAt !== null;
}

export function isVehicleIssue(
  issue: Pick<DriverIssue, 'category' | 'truck'>,
): boolean {
  return issue.category === 'vehicle' && issue.truck !== null;
}

export function resolveIssue(
  issue: DriverIssue,
  byUser: User,
  note: string,
  at: Date = new Date(),
): void {
  issue.resolvedAt = at;
  issue.resolvedBy = byUser;
  issue.resolutionNote = note;
}

export function reopenIssue(issue: DriverIssue): void {
  issue.resolvedAt = null;
  issue.resolvedBy = null;
  issue.resolutionNote = null;
}
