import {
  Check,
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

export const whatsappMessageKinds = [
  'template',
  'interactive',
  'text',
  'status',
  'unknown',
] as const;
export type WhatsAppMessageKind = (typeof whatsappMessageKinds)[number];

export const whatsappMessageStatuses = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'received',
] as const;
export type WhatsAppMessageStatus =
  (typeof whatsappMessageStatuses)[number];

const kindListSql = whatsappMessageKinds.map((kind) => `'${kind}'`).join(', ');
const statusListSql = whatsappMessageStatuses
  .map((status) => `'${status}'`)
  .join(', ');

@Entity({ tableName: 'whatsapp_messages', schema: 'app' })
@Index({
  name: 'whatsapp_messages_job_created',
  properties: ['jobId', 'createdAt'],
})
@Index({
  name: 'whatsapp_messages_provider_created',
  properties: ['providerId', 'createdAt'],
})
@Unique({
  name: 'whatsapp_messages_wamid_key',
  properties: ['wamid'],
  where: 'wamid IS NOT NULL',
})
@Check({
  name: 'whatsapp_messages_direction_check',
  expression: `direction IN ('inbound', 'outbound')`,
})
@Check({
  name: 'whatsapp_messages_kind_check',
  expression: `kind IN (${kindListSql})`,
})
@Check({
  name: 'whatsapp_messages_status_check',
  expression: `status IS NULL OR status IN (${statusListSql})`,
})
export class WhatsAppMessage {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 128, nullable: true })
  wamid!: string | null;

  @Property({ type: 'string', length: 8 })
  direction!: 'inbound' | 'outbound';

  @Property({ type: 'string', length: 20 })
  kind!: WhatsAppMessageKind;

  @Property({ type: 'uuid', nullable: true })
  jobId!: string | null;

  @Property({ type: 'uuid', nullable: true })
  offerId!: string | null;

  @Property({ type: 'uuid', nullable: true })
  providerId!: string | null;

  @Property({ type: 'string', length: 15, nullable: true })
  fromNumber!: string | null;

  @Property({ type: 'string', length: 120, nullable: true })
  profileName!: string | null;

  @Property({ type: 'string', length: 20, nullable: true })
  status!: WhatsAppMessageStatus | null;

  @Property({ type: 'string', length: 80, nullable: true })
  templateName!: string | null;

  @Property({ type: 'string', length: 32, nullable: true })
  errorCode!: string | null;

  @Property({ type: 'text', nullable: true })
  errorTitle!: string | null;

  @Property({ type: 'string', length: 128, nullable: true })
  contextWamid!: string | null;

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
