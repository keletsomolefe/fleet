import { Migration } from '@mikro-orm/migrations';

export class Migration20261116150000_chat_completion extends Migration {
  override name = 'Migration20261116150000_chat_completion';

  override up(): void {
    this.addSql(`ALTER TABLE "app"."service_job_offers"
      ADD COLUMN IF NOT EXISTS "revokedAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "chatCompletionPhone" varchar(15),
      ADD COLUMN IF NOT EXISTS "chatCompletionStartedAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "chatCompletionExpiresAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "chatCompletionRemindedAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "chatCompletionMediaIds" jsonb,
      ADD COLUMN IF NOT EXISTS "chatCompletionCostCents" integer;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "service_job_offers_chat_completion_due"
      ON "app"."service_job_offers" ("chatCompletionExpiresAt")
      WHERE "chatCompletionExpiresAt" IS NOT NULL AND "chatCompletionRemindedAt" IS NULL;`);
  }

  override down(): void {
    this.addSql(
      `DROP INDEX IF EXISTS "app"."service_job_offers_chat_completion_due";`,
    );
    this.addSql(`ALTER TABLE "app"."service_job_offers"
      DROP COLUMN IF EXISTS "chatCompletionCostCents",
      DROP COLUMN IF EXISTS "chatCompletionMediaIds",
      DROP COLUMN IF EXISTS "chatCompletionRemindedAt",
      DROP COLUMN IF EXISTS "chatCompletionExpiresAt",
      DROP COLUMN IF EXISTS "chatCompletionStartedAt",
      DROP COLUMN IF EXISTS "chatCompletionPhone",
      DROP COLUMN IF EXISTS "revokedAt";`);
  }
}
