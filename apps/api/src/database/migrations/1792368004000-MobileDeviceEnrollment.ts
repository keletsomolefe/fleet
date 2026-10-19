import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MobileDeviceEnrollment1792368004000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE app.truck_devices ADD COLUMN "credentialHash" varchar(64) UNIQUE,
      ADD COLUMN "enrolledAt" timestamptz, ADD COLUMN "lastSeenAt" timestamptz,
      ADD COLUMN "enrolledById" uuid REFERENCES app.users(id) ON DELETE SET NULL`);
    await q.query(`CREATE TABLE app.driver_truck_confirmations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "driverId" uuid NOT NULL REFERENCES app.driver_profiles(id) ON DELETE RESTRICT,
      "associationId" uuid NOT NULL REFERENCES app.device_truck_associations(id) ON DELETE RESTRICT,
      "kratosSessionId" uuid NOT NULL, "confirmedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_driver_session_truck_confirmation UNIQUE ("kratosSessionId", "associationId")
    )`);
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE app.driver_truck_confirmations');
    await q.query(
      'ALTER TABLE app.truck_devices DROP COLUMN "credentialHash", DROP COLUMN "enrolledAt", DROP COLUMN "lastSeenAt", DROP COLUMN "enrolledById"',
    );
  }
}
