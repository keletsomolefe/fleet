import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PersonalPhoneDriving1793016000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE app.driving_sessions (
      id uuid PRIMARY KEY, "driverId" uuid NOT NULL REFERENCES app.driver_profiles(id) ON DELETE RESTRICT,
      "truckId" uuid NOT NULL REFERENCES app.trucks(id) ON DELETE RESTRICT, "kratosSessionId" uuid NOT NULL,
      "startedAt" timestamptz NOT NULL DEFAULT now(), "endedAt" timestamptz,
      "endedById" uuid REFERENCES app.users(id) ON DELETE RESTRICT, "endReason" varchar(32),
      CHECK ("endedAt" IS NULL OR "endedAt">="startedAt"))`);
    await q.query(
      'CREATE UNIQUE INDEX uq_driving_active_truck ON app.driving_sessions ("truckId") WHERE "endedAt" IS NULL',
    );
    await q.query(
      'CREATE UNIQUE INDEX uq_driving_active_driver ON app.driving_sessions ("driverId") WHERE "endedAt" IS NULL',
    );
    await q.query(`CREATE TABLE app.vehicle_disputes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "truckId" uuid NOT NULL REFERENCES app.trucks(id) ON DELETE RESTRICT,
      "driverId" uuid NOT NULL REFERENCES app.driver_profiles(id) ON DELETE RESTRICT,
      "activeSessionId" uuid NOT NULL REFERENCES app.driving_sessions(id) ON DELETE RESTRICT,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "resolvedAt" timestamptz,
      "resolvedById" uuid REFERENCES app.users(id) ON DELETE RESTRICT, resolution varchar(32), note text,
      CHECK (resolution IS NULL OR resolution IN ('keep_current','release_vehicle')))`);
    await q.query(
      'CREATE UNIQUE INDEX uq_vehicle_open_dispute ON app.vehicle_disputes ("truckId","driverId") WHERE "resolvedAt" IS NULL',
    );
    await q.query(
      'CREATE INDEX idx_vehicle_dispute_open ON app.vehicle_disputes ("createdAt") WHERE "resolvedAt" IS NULL',
    );
    await q.query(`ALTER TABLE app.tracking_streams ALTER COLUMN "deviceId" DROP NOT NULL,
      ALTER COLUMN "associationId" DROP NOT NULL,
      ADD COLUMN "drivingSessionId" uuid REFERENCES app.driving_sessions(id) ON DELETE RESTRICT,
      ADD COLUMN "uploadTokenHash" varchar(64),
      ADD CONSTRAINT ck_tracking_source CHECK (
        ("drivingSessionId" IS NOT NULL AND "uploadTokenHash" IS NOT NULL AND "deviceId" IS NULL AND "associationId" IS NULL)
        OR ("drivingSessionId" IS NULL AND "uploadTokenHash" IS NULL AND "deviceId" IS NOT NULL AND "associationId" IS NOT NULL))`);
    await q.query(
      'CREATE UNIQUE INDEX uq_tracking_upload_token ON app.tracking_streams ("uploadTokenHash") WHERE "uploadTokenHash" IS NOT NULL',
    );
    await q.query(
      'CREATE INDEX idx_tracking_driving_session ON app.tracking_streams ("drivingSessionId")',
    );
    // Preserve all legacy streams and samples; the mobile upgrade stops legacy capture locally.
    await q.query(
      'UPDATE app.tracking_streams SET "endedAt"=now() WHERE "endedAt" IS NULL',
    );
  }
  async down(q: QueryRunner) {
    const rows = await q.query(
      'SELECT 1 FROM app.tracking_streams WHERE "drivingSessionId" IS NOT NULL LIMIT 1',
    );
    if (rows.length)
      throw new Error(
        'Personal-phone tracking history exists. Export or migrate it before reverting.',
      );
    await q.query(
      'ALTER TABLE app.tracking_streams DROP CONSTRAINT ck_tracking_source, DROP COLUMN "drivingSessionId", DROP COLUMN "uploadTokenHash", ALTER COLUMN "deviceId" SET NOT NULL, ALTER COLUMN "associationId" SET NOT NULL',
    );
    await q.query('DROP TABLE app.vehicle_disputes, app.driving_sessions');
  }
}
