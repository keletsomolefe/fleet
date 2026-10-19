import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminAccess1792368002000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(
      "UPDATE app.permissions SET key='admin.access', name='Admin access' WHERE key='workspace.access'",
    );
  }
  async down(q: QueryRunner) {
    await q.query(
      "UPDATE app.permissions SET key='workspace.access', name='Admin workspace' WHERE key='admin.access'",
    );
  }
}
