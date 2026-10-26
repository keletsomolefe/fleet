import type { MigrationInterface, QueryRunner } from 'typeorm';
export class DriverSchedules1793102400000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE app.driver_schedules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "driverId" uuid NOT NULL REFERENCES app.driver_profiles(id),
      "truckId" uuid NOT NULL REFERENCES app.trucks(id), date date NOT NULL, "createdById" uuid NOT NULL REFERENCES app.users(id),
      "createdAt" timestamptz NOT NULL DEFAULT now(), "cancelledAt" timestamptz, "cancelledById" uuid REFERENCES app.users(id), note text NOT NULL DEFAULT '')`);
    await q.query(
      `CREATE UNIQUE INDEX uq_schedule_driver_day ON app.driver_schedules ("driverId",date) WHERE "cancelledAt" IS NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_schedule_truck_day ON app.driver_schedules ("truckId",date) WHERE "cancelledAt" IS NULL`,
    );
    await q.query(
      `ALTER TABLE app.driving_sessions ADD COLUMN "confirmedDate" date, ADD COLUMN "scheduleId" uuid REFERENCES app.driver_schedules(id)`,
    );
    await q.query(
      `UPDATE app.driving_sessions SET "confirmedDate"=("startedAt" AT TIME ZONE 'Africa/Johannesburg')::date`,
    );
    await q.query(
      `ALTER TABLE app.driving_sessions ALTER COLUMN "confirmedDate" SET NOT NULL`,
    );
    await q.query(`ALTER TABLE app.vehicle_disputes ALTER COLUMN "activeSessionId" DROP NOT NULL,
      ADD COLUMN kind varchar(24) NOT NULL DEFAULT 'occupancy',
      ADD COLUMN "scheduleId" uuid REFERENCES app.driver_schedules(id), ADD COLUMN "scheduleDate" date,
      ADD COLUMN "requestedTruckId" uuid REFERENCES app.trucks(id), ADD COLUMN "driverNote" text`);
    await q.query(
      `ALTER TABLE app.vehicle_disputes DROP CONSTRAINT vehicle_disputes_resolution_check`,
    );
    await q.query(`ALTER TABLE app.vehicle_disputes ADD CONSTRAINT ck_dispute_resolution CHECK (resolution IS NULL OR resolution IN ('keep_current','release_vehicle','keep_schedule','change_schedule')),
      ADD CONSTRAINT ck_dispute_kind CHECK ((kind='occupancy' AND "activeSessionId" IS NOT NULL AND "scheduleId" IS NULL) OR (kind='schedule' AND "scheduleId" IS NOT NULL AND "scheduleDate" IS NOT NULL))`);
    await q.query(`DROP INDEX app.uq_vehicle_open_dispute`);
    await q.query(
      `CREATE UNIQUE INDEX uq_vehicle_open_dispute ON app.vehicle_disputes ("truckId","driverId") WHERE "resolvedAt" IS NULL AND kind='occupancy'`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_schedule_open_dispute ON app.vehicle_disputes ("driverId","scheduleDate") WHERE "resolvedAt" IS NULL AND kind='schedule'`,
    );
  }
  async down(q: QueryRunner) {
    await q.query(`DELETE FROM app.vehicle_disputes WHERE kind='schedule'`);
    await q.query(`ALTER TABLE app.vehicle_disputes DROP CONSTRAINT ck_dispute_resolution, DROP CONSTRAINT ck_dispute_kind,
      DROP COLUMN kind, DROP COLUMN "scheduleId", DROP COLUMN "scheduleDate", DROP COLUMN "requestedTruckId", DROP COLUMN "driverNote", ALTER COLUMN "activeSessionId" SET NOT NULL`);
    await q.query(
      `ALTER TABLE app.vehicle_disputes ADD CHECK (resolution IS NULL OR resolution IN ('keep_current','release_vehicle'))`,
    );
    await q.query(
      `ALTER TABLE app.driving_sessions DROP COLUMN "scheduleId", DROP COLUMN "confirmedDate"`,
    );
    await q.query(`DROP TABLE app.driver_schedules`);
    await q.query(
      `CREATE UNIQUE INDEX uq_vehicle_open_dispute ON app.vehicle_disputes ("truckId","driverId") WHERE "resolvedAt" IS NULL`,
    );
  }
}
