import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { createdAtColumn } from '../../../shared/entity-columns.js';
import { DrivingSession } from '../../driving/domain/driving-session.entity.js';
import {
  DeviceTruckAssociation,
  TruckDevice,
} from '../../fleet/domain/device.entity.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';

export const TrackingStream = defineEntity({
  name: 'TrackingStream',
  tableName: 'tracking_streams',
  schema: 'app',
  indexes: [
    {
      name: 'idx_tracking_stream_device',
      properties: ['device', 'startedAt'],
    },
    {
      name: 'idx_tracking_driving_session',
      properties: ['drivingSession'],
    },
  ],
  uniques: [
    {
      name: 'uq_tracking_upload_token',
      properties: ['uploadTokenHash'],
      where: '"uploadTokenHash" IS NOT NULL',
    },
  ],
  properties: {
    /** Client-generated UUID used as an idempotency key for stream start retries. */
    id: p.uuid().primary(),
    device: () =>
      p
        .manyToOne(TruckDevice)
        .fieldName('deviceId')
        .strictNullable()
        .deleteRule('restrict'),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    association: () =>
      p
        .manyToOne(DeviceTruckAssociation)
        .fieldName('associationId')
        .strictNullable()
        .deleteRule('restrict'),
    drivingSession: () =>
      p
        .manyToOne(DrivingSession)
        .fieldName('drivingSessionId')
        .strictNullable()
        .deleteRule('restrict'),
    /** SHA-256 stream upload token hash; hidden from default serialization. */
    uploadTokenHash: p.string().length(64).strictNullable().hidden(),
    kratosSessionId: p.uuid(),
    startedAt: createdAtColumn(),
    endedAt: p.datetime().columnType('timestamptz').strictNullable(),
    finalSequence: p.integer().strictNullable(),
  },
});

export type TrackingStream = InferEntity<typeof TrackingStream>;
