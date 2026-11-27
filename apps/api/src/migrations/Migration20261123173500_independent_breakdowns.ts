import { Migration } from '@mikro-orm/migrations';

export class Migration20261123173500_independent_breakdowns extends Migration {
  override name = 'Migration20261123173500_independent_breakdowns';

  override up(): void {
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "service_jobs_active_issue"
      ON "app"."service_jobs" ("issueId")
      WHERE "issueId" IS NOT NULL AND status IN ('open', 'assigned', 'in_progress');`);
    this.addSql(`DROP INDEX IF EXISTS "app"."service_jobs_active_truck";`);
  }

  override down(): void {
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "service_jobs_active_truck"
      ON "app"."service_jobs" ("truckId")
      WHERE status IN ('open', 'assigned', 'in_progress');`);
    this.addSql(`DROP INDEX IF EXISTS "app"."service_jobs_active_issue";`);
  }
}
