import { Migration } from '@mikro-orm/migrations';

export class Migration20261116150000_chat_completion extends Migration {
  override up(): void {
    this.addSql(`ALTER TABLE app.service_job_offers
      ADD COLUMN "revokedAt" timestamptz,
      ADD COLUMN "chatCompletionPhone" varchar(15),
      ADD COLUMN "chatCompletionStartedAt" timestamptz,
      ADD COLUMN "chatCompletionExpiresAt" timestamptz,
      ADD COLUMN "chatCompletionRemindedAt" timestamptz,
      ADD COLUMN "chatCompletionMediaIds" jsonb,
      ADD COLUMN "chatCompletionCostCents" integer;`);
    this.addSql(`CREATE INDEX service_job_offers_chat_completion_due
      ON app.service_job_offers ("chatCompletionExpiresAt")
      WHERE "chatCompletionExpiresAt" IS NOT NULL AND "chatCompletionRemindedAt" IS NULL;`);
  }
}
