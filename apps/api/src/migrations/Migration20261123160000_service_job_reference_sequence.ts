import { Migration } from '@mikro-orm/migrations';

export class Migration20261123160000_service_job_reference_sequence extends Migration {
  override up(): void {
    this.addSql(`DO $$
      DECLARE
        next_reference bigint;
      BEGIN
        IF to_regclass('app.service_job_reference_seq') IS NULL THEN
          LOCK TABLE app.service_jobs IN SHARE ROW EXCLUSIVE MODE;
          SELECT coalesce(max(substring(reference FROM 4)::bigint), 0) + 1
            INTO next_reference FROM app.service_jobs;
          EXECUTE format('CREATE SEQUENCE app.service_job_reference_seq START WITH %s', next_reference);
        END IF;
      END $$;`);
  }
}
