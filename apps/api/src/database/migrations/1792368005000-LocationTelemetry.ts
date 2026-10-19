import type { MigrationInterface, QueryRunner } from 'typeorm';
export class LocationTelemetry1792368005000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE app.tracking_streams (
      id uuid PRIMARY KEY, "deviceId" uuid NOT NULL REFERENCES app.truck_devices(id) ON DELETE RESTRICT,
      "driverId" uuid NOT NULL REFERENCES app.driver_profiles(id) ON DELETE RESTRICT,
      "associationId" uuid NOT NULL REFERENCES app.device_truck_associations(id) ON DELETE RESTRICT,
      "kratosSessionId" uuid NOT NULL, "startedAt" timestamptz NOT NULL DEFAULT now(), "endedAt" timestamptz,
      "finalSequence" int CHECK ("finalSequence">=0))`);
    await q.query(
      'CREATE INDEX idx_tracking_stream_device ON app.tracking_streams ("deviceId","startedAt")',
    );
    await q.query(`CREATE TABLE app.tracking_events (
      id uuid PRIMARY KEY, "streamId" uuid NOT NULL REFERENCES app.tracking_streams(id) ON DELETE RESTRICT,
      sequence int NOT NULL CHECK (sequence>0), kind varchar(16) NOT NULL CHECK (kind IN ('location','status')),
      "recordedAt" timestamptz NOT NULL, "receivedAt" timestamptz NOT NULL DEFAULT now(),
      latitude double precision, longitude double precision, accuracy double precision, speed double precision, heading double precision,
      mocked boolean, digest varchar(64) NOT NULL, raw jsonb NOT NULL,
      CONSTRAINT uq_tracking_stream_sequence UNIQUE ("streamId",sequence),
      CHECK (latitude BETWEEN -90 AND 90), CHECK (longitude BETWEEN -180 AND 180))`);
    await q.query(
      'CREATE INDEX idx_tracking_event_time ON app.tracking_events ("recordedAt",id)',
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE app.tracking_events, app.tracking_streams');
  }
}
