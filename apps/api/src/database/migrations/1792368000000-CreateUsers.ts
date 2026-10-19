import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1792368000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE app.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kratosIdentityId" uuid NOT NULL UNIQUE,
      email varchar(320) NOT NULL,
      "firstName" varchar(100) NOT NULL,
      "lastName" varchar(100) NOT NULL,
      "userType" varchar(20) NOT NULL DEFAULT 'admin' CHECK ("userType" IN ('admin', 'driver')),
      "isActive" boolean NOT NULL DEFAULT true,
      "createdById" uuid REFERENCES app.users(id) ON DELETE SET NULL,
      "lastLoginAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chk_users_email_normalized CHECK (email = lower(trim(email)))
    )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX uq_users_email ON app.users (email)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE app.users');
  }
}
