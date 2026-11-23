import { Migration } from '@mikro-orm/migrations';

export class Migration20261123173500_independent_breakdowns extends Migration {
  override up(): void {
    this.addSql(`CREATE UNIQUE INDEX service_jobs_active_issue ON app.service_jobs ("issueId")
      WHERE "issueId" IS NOT NULL AND status IN ('open', 'assigned', 'in_progress');`);
    this.addSql('DROP INDEX app.service_jobs_active_truck;');
  }
}
