import { Migration } from '@mikro-orm/migrations';

export class Migration20261125122341_logistics_shifts_and_expenses extends Migration {

  override name = 'Migration20261125122341_logistics_shifts_and_expenses';

  override up(): void | Promise<void> {
    this.addSql(`create table "app"."customers" ("id" uuid not null default gen_random_uuid(), "name" varchar(200) not null, "industry" varchar(120) not null default '', "contact" varchar(200) not null default '', "email" varchar(200) not null default '', "phone" varchar(40) not null default '', "notes" text not null default '', "active" boolean not null default true, "version" int not null default 1, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), primary key ("id"));`);

    this.addSql(`create table "app"."locations" ("id" uuid not null default gen_random_uuid(), "name" varchar(200) not null, "siteType" varchar(20) not null default 'both', "directions" text not null default '', "contact" varchar(200) not null default '', "phone" varchar(40) not null default '', "customerIds" uuid[] not null default '{}', "latitude" double precision null, "longitude" double precision null, "active" boolean not null default true, "version" int not null default 1, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), primary key ("id"));`);

    this.addSql(`create table "app"."products" ("id" uuid not null default gen_random_uuid(), "name" varchar(200) not null, "unit" varchar(20) not null, "active" boolean not null default true, "version" int not null default 1, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), primary key ("id"));`);

    this.addSql(`create table "app"."customer_products" ("id" uuid not null default gen_random_uuid(), "customerId" uuid not null, "productId" uuid not null, "supplies" boolean not null default false, "receives" boolean not null default false, "active" boolean not null default true, "version" int not null default 1, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "app"."customer_products" add constraint "uq_customer_products_pair" unique ("customerId", "productId");`);

    this.addSql(`create table "app"."transport_rates" ("id" uuid not null default gen_random_uuid(), "customerProductId" uuid not null, "originId" uuid null, "destinationId" uuid null, "method" varchar(20) not null, "basis" varchar(20) not null, "unit" varchar(20) not null, "price" numeric(20,6) not null, "startsOn" date not null, "endsOn" date null, "createdById" uuid not null, "createdAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "ix_transport_rate_scope" on "app"."transport_rates" ("customerProductId", "originId", "destinationId", "startsOn");`);

    this.addSql(`create table "app"."transport_audits" ("id" uuid not null default gen_random_uuid(), "recordId" uuid not null, "entityType" varchar(24) not null default 'transport_record', "actorId" uuid not null, "action" varchar(80) not null, "reason" text not null, "before" jsonb not null, "after" jsonb not null, "createdAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "ix_transport_audit_record" on "app"."transport_audits" ("recordId", "createdAt");`);

    this.addSql(`create table "app"."recording_contexts" ("id" uuid not null, "driverId" uuid not null, "truckId" uuid not null, "drivingSessionId" uuid not null, "tokenHash" varchar(64) not null, "createdAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`alter table "app"."recording_contexts" add constraint "recording_contexts_tokenHash_unique" unique ("tokenHash");`);

    this.addSql(`create table "app"."truck_expenses" ("id" uuid not null default gen_random_uuid(), "truckId" uuid not null, "driverId" uuid null, "serviceJobId" uuid null, "occurredOn" date not null, "category" varchar(24) not null, "vendor" varchar(160) not null default '', "invoiceNumber" varchar(80) not null default '', "amount" numeric(20,2) not null, "litres" numeric(12,3) null, "odometerKm" numeric(12,1) null, "notes" text not null default '', "voidedAt" timestamptz null, "voidedById" uuid null, "voidReason" text null, "createdById" uuid not null, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "ix_truck_expenses_truck_date" on "app"."truck_expenses" ("truckId", "occurredOn") where "voidedAt" IS NULL;`);
    this.addSql(`create index "ix_truck_expenses_date_category" on "app"."truck_expenses" ("occurredOn", "category") where "voidedAt" IS NULL;`);

    this.addSql(`create table "app"."dispatches" ("id" uuid not null default gen_random_uuid(), "reference" varchar(80) not null, "date" date not null, "driverId" uuid not null, "truckId" uuid not null, "plan" jsonb not null, "status" varchar(20) not null default 'dispatched', "version" int not null default 1, "createdById" uuid not null, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "ix_dispatch_driver" on "app"."dispatches" ("driverId", "date");`);
    this.addSql(`create index "ix_dispatch_truck" on "app"."dispatches" ("truckId", "date");`);
    this.addSql(`alter table "app"."dispatches" add constraint "dispatches_reference_unique" unique ("reference");`);

    this.addSql(`create table "app"."transport_records" ("id" uuid not null, "driverId" uuid not null, "truckId" uuid not null, "contextId" uuid not null, "dispatchId" uuid null, "currentActivityId" uuid not null, "kind" varchar(20) not null, "occurredAt" timestamptz not null, "data" jsonb not null, "version" int not null default 1, "review" varchar(20) not null default 'pending', "flags" varchar(255)[] not null default '{}', "reviewedById" uuid null, "reviewedAt" timestamptz null, "updatedAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "ix_transport_records_truck_time" on "app"."transport_records" ("truckId", "occurredAt");`);
    this.addSql(`create index "ix_transport_records_driver_time" on "app"."transport_records" ("driverId", "occurredAt");`);
    this.addSql(`create index "ix_transport_records_review" on "app"."transport_records" ("review", "occurredAt");`);

    this.addSql(`create table "app"."transport_charges" ("recordId" uuid not null, "rateId" uuid null, "status" varchar(20) not null, "amount" numeric(20,2) null, "snapshot" jsonb null, primary key ("recordId"));`);

    this.addSql(`create table "app"."transport_attachments" ("id" uuid not null default gen_random_uuid(), "recordId" uuid null, "truckExpenseId" uuid null, "drivingSessionId" uuid null, "kind" varchar(24) not null default 'other', "mimeType" varchar(64) not null, "byteSize" int not null, "storageName" varchar(80) not null, "uploadedByUserId" uuid null, "createdAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "ix_transport_attachments_record" on "app"."transport_attachments" ("recordId") where "recordId" IS NOT NULL;`);
    this.addSql(`create index "ix_transport_attachments_expense" on "app"."transport_attachments" ("truckExpenseId") where "truckExpenseId" IS NOT NULL;`);
    this.addSql(`create index "ix_transport_attachments_session" on "app"."transport_attachments" ("drivingSessionId") where "drivingSessionId" IS NOT NULL;`);

    this.addSql(`create table "app"."activity_revisions" ("id" uuid not null, "recordId" uuid not null, "contextId" uuid not null, "digest" varchar(64) not null, "baseVersion" int not null, "submission" jsonb not null, "conflict" boolean not null default false, "receivedAt" timestamptz not null default now(), primary key ("id"));`);
    this.addSql(`create index "ix_activity_revisions_record" on "app"."activity_revisions" ("recordId", "receivedAt");`);

    this.addSql(`alter table "app"."driving_sessions" add "startOdometerKm" numeric(12,1) null, add "startOdometerAt" timestamptz null, add "startOdometerMissingPhotoReason" text null, add "endOdometerKm" numeric(12,1) null, add "endOdometerAt" timestamptz null, add "endOdometerMissingPhotoReason" text null, add "endOdometerLowerReason" text null, add "mileageFlags" varchar(255)[] not null default '{}', add "mileageReviewedAt" timestamptz null, add "mileageReviewedById" uuid null, add "mileageReviewNote" text null;`);
    this.addSql(`alter table "app"."driving_sessions" add constraint "driving_sessions_mileageReviewedById_foreign" foreign key ("mileageReviewedById") references "app"."users" ("id") on delete set null;`);
    this.addSql(`create index "idx_driving_sessions_truck_started" on "app"."driving_sessions" ("truckId", "startedAt");`);
    this.addSql(`create index "idx_driving_sessions_driver_started" on "app"."driving_sessions" ("driverId", "startedAt");`);
    this.addSql(`alter table "app"."driving_sessions" add constraint "driving_sessions_start_odometer_check" check ("startOdometerKm" IS NULL OR "startOdometerKm" >= 0);`);
    this.addSql(`alter table "app"."driving_sessions" add constraint "driving_sessions_end_odometer_check" check ("endOdometerKm" IS NULL OR "endOdometerKm" >= 0);`);

    this.addSql(`alter table "app"."locations" add constraint "locations_site_type_check" check ("siteType" IN ('collection', 'delivery', 'both', 'fuel_station', 'yard'));`);
    this.addSql(`alter table "app"."locations" add constraint "locations_latitude_check" check (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));`);
    this.addSql(`alter table "app"."locations" add constraint "locations_longitude_check" check (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));`);
    this.addSql(`alter table "app"."locations" add constraint "locations_coordinates_pair_check" check ((latitude IS NULL) = (longitude IS NULL));`);

    this.addSql(`alter table "app"."products" add constraint "products_unit_check" check (unit IN ('tonne', 'kg', 'litre', 'm3', 'pallet', 'item'));`);

    this.addSql(`alter table "app"."customer_products" add constraint "customer_products_customerId_foreign" foreign key ("customerId") references "app"."customers" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."customer_products" add constraint "customer_products_productId_foreign" foreign key ("productId") references "app"."products" ("id") on delete restrict;`);

    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_customerProductId_foreign" foreign key ("customerProductId") references "app"."customer_products" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_originId_foreign" foreign key ("originId") references "app"."locations" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_destinationId_foreign" foreign key ("destinationId") references "app"."locations" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_createdById_foreign" foreign key ("createdById") references "app"."users" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_method_check" check (method IN ('quantity', 'delivery'));`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_basis_check" check (basis IN ('collected', 'delivered'));`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_unit_check" check (unit IN ('tonne', 'kg', 'litre', 'm3', 'pallet', 'item'));`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_price_check" check (price >= 0);`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_window_check" check ("endsOn" IS NULL OR "endsOn" >= "startsOn");`);
    this.addSql(`alter table "app"."transport_rates" add constraint "transport_rates_route_pair_check" check (("originId" IS NULL) = ("destinationId" IS NULL));`);

    this.addSql(`alter table "app"."transport_audits" add constraint "transport_audits_actorId_foreign" foreign key ("actorId") references "app"."users" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_audits" add constraint "transport_audits_entity_type_check" check ("entityType" IN ('transport_record', 'truck_expense', 'driving_session'));`);

    this.addSql(`alter table "app"."recording_contexts" add constraint "recording_contexts_driverId_foreign" foreign key ("driverId") references "app"."driver_profiles" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."recording_contexts" add constraint "recording_contexts_truckId_foreign" foreign key ("truckId") references "app"."trucks" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."recording_contexts" add constraint "recording_contexts_drivingSessionId_foreign" foreign key ("drivingSessionId") references "app"."driving_sessions" ("id") on delete restrict;`);

    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_truckId_foreign" foreign key ("truckId") references "app"."trucks" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_driverId_foreign" foreign key ("driverId") references "app"."driver_profiles" ("id") on delete set null;`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_serviceJobId_foreign" foreign key ("serviceJobId") references "app"."service_jobs" ("id") on delete set null;`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_voidedById_foreign" foreign key ("voidedById") references "app"."users" ("id") on delete set null;`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_createdById_foreign" foreign key ("createdById") references "app"."users" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_category_check" check (category IN ('fuel', 'repair', 'tyres', 'toll', 'weighbridge', 'maintenance', 'insurance', 'licence', 'permits', 'parking', 'other'));`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_amount_check" check (amount >= 0);`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_litres_check" check (litres IS NULL OR litres >= 0);`);
    this.addSql(`alter table "app"."truck_expenses" add constraint "truck_expenses_odometer_check" check ("odometerKm" IS NULL OR "odometerKm" >= 0);`);

    this.addSql(`alter table "app"."dispatches" add constraint "dispatches_driverId_foreign" foreign key ("driverId") references "app"."driver_profiles" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."dispatches" add constraint "dispatches_truckId_foreign" foreign key ("truckId") references "app"."trucks" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."dispatches" add constraint "dispatches_createdById_foreign" foreign key ("createdById") references "app"."users" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."dispatches" add constraint "dispatches_status_check" check (status IN ('draft', 'dispatched', 'completed', 'cancelled'));`);

    this.addSql(`alter table "app"."transport_records" add constraint "transport_records_driverId_foreign" foreign key ("driverId") references "app"."driver_profiles" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_records" add constraint "transport_records_truckId_foreign" foreign key ("truckId") references "app"."trucks" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_records" add constraint "transport_records_contextId_foreign" foreign key ("contextId") references "app"."recording_contexts" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."transport_records" add constraint "transport_records_dispatchId_foreign" foreign key ("dispatchId") references "app"."dispatches" ("id") on delete set null;`);
    this.addSql(`alter table "app"."transport_records" add constraint "transport_records_reviewedById_foreign" foreign key ("reviewedById") references "app"."users" ("id") on delete set null;`);
    this.addSql(`alter table "app"."transport_records" add constraint "transport_records_kind_check" check (kind IN ('collection', 'delivery', 'fuel', 'expense'));`);
    this.addSql(`alter table "app"."transport_records" add constraint "transport_records_review_check" check (review IN ('pending', 'validated', 'clarification', 'void'));`);

    this.addSql(`alter table "app"."transport_charges" add constraint "transport_charges_recordId_foreign" foreign key ("recordId") references "app"."transport_records" ("id") on update cascade on delete restrict;`);
    this.addSql(`alter table "app"."transport_charges" add constraint "transport_charges_rateId_foreign" foreign key ("rateId") references "app"."transport_rates" ("id") on delete set null;`);
    this.addSql(`alter table "app"."transport_charges" add constraint "transport_charges_status_check" check (status IN ('priced', 'needs_pricing', 'uncharged'));`);
    this.addSql(`alter table "app"."transport_charges" add constraint "transport_charges_amount_check" check (amount IS NULL OR amount >= 0);`);
    this.addSql(`alter table "app"."transport_charges" add constraint "transport_charges_priced_amount_check" check ((status = 'priced') = (amount IS NOT NULL));`);

    this.addSql(`alter table "app"."transport_attachments" add constraint "transport_attachments_recordId_foreign" foreign key ("recordId") references "app"."transport_records" ("id") on delete cascade;`);
    this.addSql(`alter table "app"."transport_attachments" add constraint "transport_attachments_truckExpenseId_foreign" foreign key ("truckExpenseId") references "app"."truck_expenses" ("id") on delete cascade;`);
    this.addSql(`alter table "app"."transport_attachments" add constraint "transport_attachments_drivingSessionId_foreign" foreign key ("drivingSessionId") references "app"."driving_sessions" ("id") on delete cascade;`);
    this.addSql(`alter table "app"."transport_attachments" add constraint "transport_attachments_uploadedByUserId_foreign" foreign key ("uploadedByUserId") references "app"."users" ("id") on delete set null;`);
    this.addSql(`alter table "app"."transport_attachments" add constraint "transport_attachments_kind_check" check (kind IN ('pod', 'weighbridge_ticket', 'fuel_receipt', 'expense_receipt', 'start_odometer_photo', 'end_odometer_photo', 'other'));`);
    this.addSql(`alter table "app"."transport_attachments" add constraint "transport_attachments_size_check" check ("byteSize" > 0);`);
    this.addSql(`alter table "app"."transport_attachments" add constraint "transport_attachments_single_owner_check" check ((("recordId" IS NOT NULL)::int + ("truckExpenseId" IS NOT NULL)::int + ("drivingSessionId" IS NOT NULL)::int) = 1);`);

    this.addSql(`alter table "app"."activity_revisions" add constraint "activity_revisions_recordId_foreign" foreign key ("recordId") references "app"."transport_records" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."activity_revisions" add constraint "activity_revisions_contextId_foreign" foreign key ("contextId") references "app"."recording_contexts" ("id") on delete restrict;`);
    this.addSql(`alter table "app"."activity_revisions" add constraint "activity_revisions_base_version_check" check ("baseVersion" >= 0);`);

    this.addSql(`create unique index if not exists "uq_customer_name" on "app"."customers" (lower("name"));`);
    this.addSql(`create unique index if not exists "uq_product_name" on "app"."products" (lower("name"));`);
    this.addSql(`create index if not exists "ix_transport_records_run" on "app"."transport_records" ((data->>'runId'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "app"."ix_transport_records_run";`);
    this.addSql(`drop index if exists "app"."uq_product_name";`);
    this.addSql(`drop index if exists "app"."uq_customer_name";`);

    this.addSql(`drop table if exists "app"."activity_revisions" cascade;`);
    this.addSql(`drop table if exists "app"."transport_attachments" cascade;`);
    this.addSql(`drop table if exists "app"."transport_charges" cascade;`);
    this.addSql(`drop table if exists "app"."transport_records" cascade;`);
    this.addSql(`drop table if exists "app"."dispatches" cascade;`);
    this.addSql(`drop table if exists "app"."truck_expenses" cascade;`);
    this.addSql(`drop table if exists "app"."recording_contexts" cascade;`);
    this.addSql(`drop table if exists "app"."transport_audits" cascade;`);
    this.addSql(`drop table if exists "app"."transport_rates" cascade;`);
    this.addSql(`drop table if exists "app"."customer_products" cascade;`);
    this.addSql(`drop table if exists "app"."products" cascade;`);
    this.addSql(`drop table if exists "app"."locations" cascade;`);
    this.addSql(`drop table if exists "app"."customers" cascade;`);

    this.addSql(`alter table "app"."driving_sessions" drop constraint if exists "driving_sessions_mileageReviewedById_foreign";`);
    this.addSql(`drop index if exists "app"."idx_driving_sessions_truck_started";`);
    this.addSql(`drop index if exists "app"."idx_driving_sessions_driver_started";`);
    this.addSql(`alter table "app"."driving_sessions" drop constraint if exists "driving_sessions_start_odometer_check";`);
    this.addSql(`alter table "app"."driving_sessions" drop constraint if exists "driving_sessions_end_odometer_check";`);
    this.addSql(`alter table "app"."driving_sessions" drop column if exists "startOdometerKm", drop column if exists "startOdometerAt", drop column if exists "startOdometerMissingPhotoReason", drop column if exists "endOdometerKm", drop column if exists "endOdometerAt", drop column if exists "endOdometerMissingPhotoReason", drop column if exists "endOdometerLowerReason", drop column if exists "mileageFlags", drop column if exists "mileageReviewedAt", drop column if exists "mileageReviewedById", drop column if exists "mileageReviewNote";`);
  }

}
