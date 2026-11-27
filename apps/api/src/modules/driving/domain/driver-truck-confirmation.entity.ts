import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { DeviceTruckAssociation } from '../../fleet/domain/device.entity.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';

export const DriverTruckConfirmation = defineEntity({
  name: 'DriverTruckConfirmation',
  tableName: 'driver_truck_confirmations',
  schema: 'app',
  uniques: [
    {
      name: 'uq_driver_session_truck_confirmation',
      properties: ['kratosSessionId', 'association'],
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    association: () =>
      p
        .manyToOne(DeviceTruckAssociation)
        .fieldName('associationId')
        .deleteRule('restrict'),
    kratosSessionId: p.uuid(),
    confirmedAt: createdAtColumn(),
  },
});

export type DriverTruckConfirmation = InferEntity<
  typeof DriverTruckConfirmation
>;
