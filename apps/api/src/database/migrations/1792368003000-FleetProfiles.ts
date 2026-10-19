import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FleetProfiles1792368003000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE app.trucks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      identifier varchar(40) NOT NULL UNIQUE, registration varchar(30) NOT NULL UNIQUE,
      "registrationCountry" varchar(2) NOT NULL, make varchar(80) NOT NULL, model varchar(80) NOT NULL,
      year int CHECK (year BETWEEN 1950 AND 2200), vin varchar(17) UNIQUE, "engineNumber" varchar(80),
      category varchar(30) NOT NULL CHECK (category IN ('rigid','tractor','tipper','tanker','flatbed','other')),
      "fuelType" varchar(20) NOT NULL CHECK ("fuelType" IN ('diesel','petrol','electric','hybrid','other')),
      transmission varchar(20) CHECK (transmission IN ('manual','automatic','automated')),
      "axleCount" int CHECK ("axleCount" BETWEEN 2 AND 20),
      "grossVehicleMassKg" int CHECK ("grossVehicleMassKg">0), "tareKg" int CHECK ("tareKg">0),
      "payloadCapacityKg" int CHECK ("payloadCapacityKg">0), "odometerKm" int NOT NULL CHECK ("odometerKm">=0),
      "tankCapacityLitres" int CHECK ("tankCapacityLitres">0), "licenceDiscExpiresOn" date,
      "roadworthyExpiresOn" date, "insuranceProvider" varchar(100), "insurancePolicyNumber" varchar(100),
      "insuranceExpiresOn" date, "serviceIntervalKm" int CHECK ("serviceIntervalKm">0),
      "nextServiceDueKm" int CHECK ("nextServiceDueKm">=0),
      status varchar(20) NOT NULL CHECK (status IN ('active','maintenance','inactive')), notes text,
      "createdById" uuid REFERENCES app.users(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CHECK ("tareKg" <= "grossVehicleMassKg"),
      CHECK ("payloadCapacityKg" <= "grossVehicleMassKg"),
      CHECK ("tareKg" + "payloadCapacityKg" <= "grossVehicleMassKg")
    )`);
    await q.query(`CREATE TABLE app.truck_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier varchar(80) NOT NULL UNIQUE,
      "serialNumber" varchar(100) UNIQUE, "currentTruckId" uuid UNIQUE REFERENCES app.trucks(id) ON DELETE RESTRICT,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE app.driver_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE RESTRICT,
      identifier varchar(40) NOT NULL UNIQUE, phone varchar(30) NOT NULL,
      "licenceNumber" varchar(80) NOT NULL, "licenceCode" varchar(10) NOT NULL,
      "licenceCountry" varchar(2) NOT NULL, "licenceExpiresOn" date NOT NULL,
      "prdpNumber" varchar(80), "prdpExpiresOn" date,
      "emergencyContactName" varchar(100), "emergencyContactPhone" varchar(30),
      status varchar(20) NOT NULL CHECK (status IN ('active','inactive')),
      "currentTruckId" uuid UNIQUE REFERENCES app.trucks(id) ON DELETE RESTRICT, notes text,
      "createdById" uuid REFERENCES app.users(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("licenceCountry", "licenceNumber"),
      CHECK (("prdpNumber" IS NULL) = ("prdpExpiresOn" IS NULL)),
      CHECK (("emergencyContactName" IS NULL) = ("emergencyContactPhone" IS NULL)),
      CHECK (status='active' OR "currentTruckId" IS NULL)
    )`);
    await q.query(`CREATE TABLE app.driver_truck_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "driverId" uuid NOT NULL REFERENCES app.driver_profiles(id) ON DELETE RESTRICT,
      "truckId" uuid NOT NULL REFERENCES app.trucks(id) ON DELETE RESTRICT,
      "changedById" uuid REFERENCES app.users(id) ON DELETE SET NULL,
      "startedAt" timestamptz NOT NULL DEFAULT now(), "endedAt" timestamptz,
      CHECK ("endedAt" >= "startedAt")
    )`);
    await q.query(
      'CREATE UNIQUE INDEX uq_driver_current_assignment ON app.driver_truck_assignments ("driverId") WHERE "endedAt" IS NULL',
    );
    await q.query(
      'CREATE UNIQUE INDEX uq_truck_current_assignment ON app.driver_truck_assignments ("truckId") WHERE "endedAt" IS NULL',
    );
    await q.query(
      'CREATE INDEX idx_driver_assignment_history ON app.driver_truck_assignments ("driverId", "startedAt")',
    );
    await q.query(`CREATE TABLE app.device_truck_associations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "deviceId" uuid NOT NULL REFERENCES app.truck_devices(id) ON DELETE RESTRICT,
      "truckId" uuid NOT NULL REFERENCES app.trucks(id) ON DELETE RESTRICT,
      "changedById" uuid REFERENCES app.users(id) ON DELETE SET NULL,
      "startedAt" timestamptz NOT NULL DEFAULT now(), "endedAt" timestamptz,
      CHECK ("endedAt" >= "startedAt")
    )`);
    await q.query(
      'CREATE UNIQUE INDEX uq_device_current_association ON app.device_truck_associations ("deviceId") WHERE "endedAt" IS NULL',
    );
    await q.query(
      'CREATE UNIQUE INDEX uq_truck_current_device ON app.device_truck_associations ("truckId") WHERE "endedAt" IS NULL',
    );
    await q.query(
      'CREATE INDEX idx_device_association_history ON app.device_truck_associations ("truckId", "startedAt")',
    );
    for (const [key, name] of [
      ['drivers.write', 'Manage driver profiles'],
      ['trucks.write', 'Manage trucks and devices'],
    ]) {
      await q.query('INSERT INTO app.permissions (key, name) VALUES ($1,$2)', [
        key,
        name,
      ]);
      await q.query(
        `INSERT INTO app.role_permissions ("roleId", "permissionId")
        SELECT r.id, p.id FROM app.roles r CROSS JOIN app.permissions p
        WHERE r.key IN ('owner','administrator') AND p.key=$1`,
        [key],
      );
    }
  }
  async down(q: QueryRunner) {
    await q.query(
      "DELETE FROM app.permissions WHERE key IN ('drivers.write','trucks.write')",
    );
    await q.query(
      'DROP TABLE app.device_truck_associations, app.driver_truck_assignments, app.driver_profiles, app.truck_devices, app.trucks',
    );
  }
}
