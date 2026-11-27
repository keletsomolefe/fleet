import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { createdAtColumn } from '../../../shared/entity-columns.js';
import { TrackingStream } from './tracking-stream.entity.js';

export const trackingEventKinds = ['location', 'status'] as const;
export type TrackingEventKind = (typeof trackingEventKinds)[number];

const kindSql = trackingEventKinds.map((v) => `'${v}'`).join(', ');

export const TrackingEvent = defineEntity({
  name: 'TrackingEvent',
  tableName: 'tracking_events',
  schema: 'app',
  uniques: [
    {
      name: 'uq_tracking_stream_sequence',
      properties: ['stream', 'sequence'],
    },
  ],
  indexes: [
    {
      name: 'idx_tracking_event_time',
      properties: ['recordedAt', 'id'],
    },
  ],
  checks: [
    {
      name: 'tracking_events_kind_check',
      expression: `kind IN (${kindSql})`,
    },
    {
      name: 'tracking_events_sequence_check',
      expression: 'sequence >= 1',
    },
  ],
  properties: {
    /** Client-generated UUID used as an idempotency key for offline batch retries. */
    id: p.uuid().primary(),
    stream: () =>
      p
        .manyToOne(TrackingStream)
        .fieldName('streamId')
        .deleteRule('restrict'),
    sequence: p.integer(),
    kind: p.string().length(16).$type<TrackingEventKind>(),
    recordedAt: p.datetime().columnType('timestamptz'),
    receivedAt: createdAtColumn(),
    latitude: p.double().strictNullable(),
    longitude: p.double().strictNullable(),
    accuracy: p.double().strictNullable(),
    speed: p.double().strictNullable(),
    heading: p.double().strictNullable(),
    mocked: p.boolean().strictNullable(),
    digest: p.string().length(64),
    raw: p.json<Record<string, unknown>>().columnType('jsonb'),
    unconfirmed: p.boolean().default(false),
  },
});

export type TrackingEvent = InferEntity<typeof TrackingEvent>;
