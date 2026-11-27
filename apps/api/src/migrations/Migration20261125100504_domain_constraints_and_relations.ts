import { Migration } from '@mikro-orm/migrations';

export class Migration20261125100504_domain_constraints_and_relations extends Migration {

  override name = 'Migration20261125100504_domain_constraints_and_relations';

  private addConstraintIfMissing(sql: string): void {
    this.addSql(
      `DO $$ BEGIN ${sql} EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    );
  }

  override up(): void | Promise<void> {
    this.addConstraintIfMissing(`alter table "app"."trucks" add constraint "trucks_createdById_foreign" foreign key ("createdById") references "app"."users" ("id") on delete set null;`);
    this.addSql(`create index if not exists "idx_trucks_status" on "app"."trucks" ("status");`);
    this.addConstraintIfMissing(`alter table "app"."trucks" add constraint "trucks_category_check" check (category IN ('rigid', 'tractor', 'tipper', 'tanker', 'flatbed', 'other'));`);
    this.addConstraintIfMissing(`alter table "app"."trucks" add constraint "trucks_fuel_type_check" check ("fuelType" IN ('diesel', 'petrol', 'electric', 'hybrid', 'other'));`);
    this.addConstraintIfMissing(`alter table "app"."trucks" add constraint "trucks_transmission_check" check (transmission IS NULL OR transmission IN ('manual', 'automatic', 'automated'));`);
    this.addConstraintIfMissing(`alter table "app"."trucks" add constraint "trucks_status_check" check (status IN ('active', 'maintenance', 'inactive'));`);
    this.addConstraintIfMissing(`alter table "app"."trucks" add constraint "trucks_odometer_check" check ("odometerKm" >= 0);`);

    this.addConstraintIfMissing(`alter table "app"."driver_profiles" add constraint "driver_profiles_createdById_foreign" foreign key ("createdById") references "app"."users" ("id") on delete set null;`);
    this.addSql(`create index if not exists "idx_driver_profiles_status" on "app"."driver_profiles" ("status");`);
    this.addConstraintIfMissing(`alter table "app"."driver_profiles" add constraint "driver_profiles_status_check" check (status IN ('active', 'inactive'));`);

    this.addConstraintIfMissing(`alter table "app"."driver_truck_assignments" add constraint "driver_truck_assignments_changedById_foreign" foreign key ("changedById") references "app"."users" ("id") on delete set null;`);

    this.addConstraintIfMissing(`alter table "app"."driver_schedules" add constraint "driver_schedules_driverId_foreign" foreign key ("driverId") references "app"."driver_profiles" ("id") on delete restrict;`);
    this.addConstraintIfMissing(`alter table "app"."driver_schedules" add constraint "driver_schedules_truckId_foreign" foreign key ("truckId") references "app"."trucks" ("id") on delete restrict;`);
    this.addConstraintIfMissing(`alter table "app"."driver_schedules" add constraint "driver_schedules_createdById_foreign" foreign key ("createdById") references "app"."users" ("id") on delete restrict;`);
    this.addConstraintIfMissing(`alter table "app"."driver_schedules" add constraint "driver_schedules_cancelledById_foreign" foreign key ("cancelledById") references "app"."users" ("id") on delete set null;`);
    this.addSql(`create index if not exists "idx_driver_schedules_active_date" on "app"."driver_schedules" ("date") where "cancelledAt" IS NULL;`);

    this.addConstraintIfMissing(`alter table "app"."driving_sessions" add constraint "driving_sessions_scheduleId_foreign" foreign key ("scheduleId") references "app"."driver_schedules" ("id") on delete set null;`);
    this.addConstraintIfMissing(`alter table "app"."driving_sessions" add constraint "driving_sessions_endedById_foreign" foreign key ("endedById") references "app"."users" ("id") on delete set null;`);
    this.addSql(`create index if not exists "idx_driving_sessions_kratos_active" on "app"."driving_sessions" ("kratosSessionId") where "endedAt" IS NULL;`);

    this.addConstraintIfMissing(`alter table "app"."driver_issues" add constraint "driver_issues_category_check" check (category IN ('vehicle', 'safety', 'other'));`);

    this.addConstraintIfMissing(`alter table "app"."service_job_attachments" add constraint "service_job_attachments_uploadedByProviderId_foreign" foreign key ("uploadedByProviderId") references "app"."service_providers" ("id") on delete set null;`);
    this.addConstraintIfMissing(`alter table "app"."service_job_attachments" add constraint "service_job_attachments_uploadedByUserId_foreign" foreign key ("uploadedByUserId") references "app"."users" ("id") on delete set null;`);

    this.addConstraintIfMissing(`alter table "app"."device_truck_associations" add constraint "device_truck_associations_changedById_foreign" foreign key ("changedById") references "app"."users" ("id") on delete set null;`);

    this.addConstraintIfMissing(`alter table "app"."tracking_events" add constraint "tracking_events_kind_check" check (kind IN ('location', 'status'));`);
    this.addConstraintIfMissing(`alter table "app"."tracking_events" add constraint "tracking_events_sequence_check" check (sequence >= 1);`);

    this.addConstraintIfMissing(`alter table "app"."vehicle_disputes" add constraint "vehicle_disputes_scheduleId_foreign" foreign key ("scheduleId") references "app"."driver_schedules" ("id") on delete set null;`);
    this.addConstraintIfMissing(`alter table "app"."vehicle_disputes" add constraint "vehicle_disputes_requestedTruckId_foreign" foreign key ("requestedTruckId") references "app"."trucks" ("id") on delete restrict;`);
    this.addConstraintIfMissing(`alter table "app"."vehicle_disputes" add constraint "vehicle_disputes_kind_check" check (kind IN ('occupancy', 'schedule'));`);

    this.addConstraintIfMissing(`alter table "app"."whatsapp_messages" add constraint "whatsapp_messages_jobId_foreign" foreign key ("jobId") references "app"."service_jobs" ("id") on delete set null;`);
    this.addConstraintIfMissing(`alter table "app"."whatsapp_messages" add constraint "whatsapp_messages_offerId_foreign" foreign key ("offerId") references "app"."service_job_offers" ("id") on delete set null;`);
    this.addConstraintIfMissing(`alter table "app"."whatsapp_messages" add constraint "whatsapp_messages_providerId_foreign" foreign key ("providerId") references "app"."service_providers" ("id") on delete set null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "app"."device_truck_associations" drop constraint if exists "device_truck_associations_changedById_foreign";`);

    this.addSql(`alter table "app"."driver_profiles" drop constraint if exists "driver_profiles_createdById_foreign";`);

    this.addSql(`alter table "app"."driver_schedules" drop constraint if exists "driver_schedules_driverId_foreign";`);
    this.addSql(`alter table "app"."driver_schedules" drop constraint if exists "driver_schedules_truckId_foreign";`);
    this.addSql(`alter table "app"."driver_schedules" drop constraint if exists "driver_schedules_createdById_foreign";`);
    this.addSql(`alter table "app"."driver_schedules" drop constraint if exists "driver_schedules_cancelledById_foreign";`);

    this.addSql(`alter table "app"."driver_truck_assignments" drop constraint if exists "driver_truck_assignments_changedById_foreign";`);

    this.addSql(`alter table "app"."driving_sessions" drop constraint if exists "driving_sessions_scheduleId_foreign";`);
    this.addSql(`alter table "app"."driving_sessions" drop constraint if exists "driving_sessions_endedById_foreign";`);

    this.addSql(`alter table "app"."service_job_attachments" drop constraint if exists "service_job_attachments_uploadedByProviderId_foreign";`);
    this.addSql(`alter table "app"."service_job_attachments" drop constraint if exists "service_job_attachments_uploadedByUserId_foreign";`);

    this.addSql(`alter table "app"."trucks" drop constraint if exists "trucks_createdById_foreign";`);

    this.addSql(`alter table "app"."vehicle_disputes" drop constraint if exists "vehicle_disputes_scheduleId_foreign";`);
    this.addSql(`alter table "app"."vehicle_disputes" drop constraint if exists "vehicle_disputes_requestedTruckId_foreign";`);

    this.addSql(`alter table "app"."whatsapp_messages" drop constraint if exists "whatsapp_messages_jobId_foreign";`);
    this.addSql(`alter table "app"."whatsapp_messages" drop constraint if exists "whatsapp_messages_offerId_foreign";`);
    this.addSql(`alter table "app"."whatsapp_messages" drop constraint if exists "whatsapp_messages_providerId_foreign";`);

    this.addSql(`alter table "app"."driver_issues" drop constraint if exists "driver_issues_category_check";`);

    this.addSql(`drop index if exists "app"."idx_driver_profiles_status";`);
    this.addSql(`alter table "app"."driver_profiles" drop constraint if exists "driver_profiles_status_check";`);

    this.addSql(`drop index if exists "app"."idx_driver_schedules_active_date";`);

    this.addSql(`drop index if exists "app"."idx_driving_sessions_kratos_active";`);

    this.addSql(`alter table "app"."tracking_events" drop constraint if exists "tracking_events_kind_check";`);
    this.addSql(`alter table "app"."tracking_events" drop constraint if exists "tracking_events_sequence_check";`);

    this.addSql(`drop index if exists "app"."idx_trucks_status";`);
    this.addSql(`alter table "app"."trucks" drop constraint if exists "trucks_category_check";`);
    this.addSql(`alter table "app"."trucks" drop constraint if exists "trucks_fuel_type_check";`);
    this.addSql(`alter table "app"."trucks" drop constraint if exists "trucks_transmission_check";`);
    this.addSql(`alter table "app"."trucks" drop constraint if exists "trucks_status_check";`);
    this.addSql(`alter table "app"."trucks" drop constraint if exists "trucks_odometer_check";`);

    this.addSql(`alter table "app"."vehicle_disputes" drop constraint if exists "vehicle_disputes_kind_check";`);
  }

}
