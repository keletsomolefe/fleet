import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { CalendarDateType } from '../database/calendar-date.type.js';

@Entity({ tableName: 'driver_schedules', schema: 'app' })
@Unique({
  name: 'uq_schedule_driver_day',
  properties: ['driverId', 'date'],
  where: '"cancelledAt" IS NULL',
})
@Unique({
  name: 'uq_schedule_truck_day',
  properties: ['truckId', 'date'],
  where: '"cancelledAt" IS NULL',
})
export class DriverSchedule {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'uuid' })
  driverId!: string;

  @Property({ type: 'uuid' })
  truckId!: string;

  @Property({ type: CalendarDateType })
  date!: string;

  @Property({ type: 'uuid' })
  createdById!: string;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Property({ type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Property({ type: 'text', default: '' })
  note!: string;
}
