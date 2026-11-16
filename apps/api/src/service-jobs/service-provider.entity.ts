import { entityId } from '../database/database.js';
import {
  Check,
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import type { Rel } from '@mikro-orm/postgresql';
import { User } from '../users/user.entity.js';

export const providerServices = [
  'mechanical',
  'tyres',
  'towing',
  'electrical',
  'bodywork',
  'fuel',
  'accident',
  'other',
] as const;

export type ProviderService = (typeof providerServices)[number];

const serviceListSql = providerServices
  .map((service) => `'${service}'`)
  .join(', ');

@Entity({ tableName: 'service_providers', schema: 'app' })
@Index({
  name: 'service_providers_status_name',
  properties: ['status', 'companyName'],
})
@Unique({
  name: 'service_providers_whatsapp_key',
  properties: ['whatsappNumber'],
})
@Check({
  name: 'service_providers_company_check',
  expression: `((length(btrim(("companyName")::text)) >= 1) AND (length(btrim(("companyName")::text)) <= 120))`,
})
@Check({
  name: 'service_providers_contact_check',
  expression: `((length(btrim(("contactName")::text)) >= 1) AND (length(btrim(("contactName")::text)) <= 80))`,
})
@Check({
  name: 'service_providers_whatsapp_check',
  expression: `"whatsappNumber" ~ '^[1-9][0-9]{7,14}$'`,
})
@Check({
  name: 'service_providers_status_check',
  expression: `status IN ('active', 'paused')`,
})
@Check({
  name: 'service_providers_services_check',
  expression: `services <@ ARRAY[${serviceListSql}]::text[]`,
})
export class ServiceProvider {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 120 })
  companyName!: string;

  @Property({ type: 'string', length: 80 })
  contactName!: string;

  @Property({ type: 'string', length: 15 })
  whatsappNumber!: string;

  @Property({ type: 'string', length: 30, nullable: true })
  phone!: string | null;

  @Property({ type: 'string', length: 320, nullable: true })
  email!: string | null;

  @Property({
    type: 'string',
    array: true,
    columnType: 'text[]',
    defaultRaw: `'{}'`,
  })
  services!: ProviderService[];

  @Property({ type: 'string', length: 120, nullable: true })
  coverageArea!: string | null;

  @Property({ type: 'text', nullable: true })
  notes!: string | null;

  @Property({ type: 'string', length: 16, default: 'active' })
  status!: 'active' | 'paused';

  @Property({ type: 'boolean', default: true })
  alertsEnabled!: boolean;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  optedInAt!: Date | null;

  @ManyToOne(() => User, {
    fieldName: 'optInById',
    nullable: true,
    deleteRule: 'set null',
  })
  optInBy!: Rel<User> | null;

  get optInById(): string | null {
    return entityId(this.optInBy);
  }

  set optInById(value: string | null) {
    this.optInBy = (value as unknown as Rel<User> | null);
  }

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  optedOutAt!: Date | null;

  @Property({ type: 'text', nullable: true })
  optOutReason!: string | null;

  @ManyToOne(() => User, {
    fieldName: 'createdById',
    nullable: true,
    deleteRule: 'set null',
  })
  createdBy!: Rel<User> | null;

  get createdById(): string | null {
    return entityId(this.createdBy);
  }

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
