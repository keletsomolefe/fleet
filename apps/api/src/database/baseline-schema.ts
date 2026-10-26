// Final pre-launch application schema, consolidated from the existing migrations.
export const baselineSchema = `
CREATE TABLE app.device_truck_associations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "deviceId" uuid NOT NULL,
    "truckId" uuid NOT NULL,
    "changedById" uuid,
    "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "endedAt" timestamp with time zone,
    CONSTRAINT device_truck_associations_check CHECK (("endedAt" >= "startedAt"))
);

CREATE TABLE app.driver_issues (
    id uuid NOT NULL,
    "driverId" uuid NOT NULL,
    "truckId" uuid,
    category character varying(24) NOT NULL,
    description text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "resolvedAt" timestamp with time zone,
    "resolvedById" uuid,
    "resolutionNote" text,
    CONSTRAINT ck_issue_resolution CHECK (((("resolvedAt" IS NULL) AND ("resolvedById" IS NULL) AND ("resolutionNote" IS NULL)) OR (("resolvedAt" IS NOT NULL) AND ("resolvedById" IS NOT NULL) AND ("resolutionNote" IS NOT NULL) AND ((length(btrim("resolutionNote")) >= 1) AND (length(btrim("resolutionNote")) <= 1000))))),
    CONSTRAINT driver_issues_category_check CHECK (((category)::text = ANY ((ARRAY['vehicle'::character varying, 'safety'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT driver_issues_description_check CHECK (((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 2000)))
);

CREATE TABLE app.driver_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    identifier character varying(40) NOT NULL,
    phone character varying(30) NOT NULL,
    "licenceNumber" character varying(80) NOT NULL,
    "licenceCode" character varying(10) NOT NULL,
    "licenceCountry" character varying(2) NOT NULL,
    "licenceExpiresOn" date NOT NULL,
    "prdpNumber" character varying(80),
    "prdpExpiresOn" date,
    "emergencyContactName" character varying(100),
    "emergencyContactPhone" character varying(30),
    status character varying(20) NOT NULL,
    "currentTruckId" uuid,
    notes text,
    "createdById" uuid,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT driver_profiles_check CHECK ((("prdpNumber" IS NULL) = ("prdpExpiresOn" IS NULL))),
    CONSTRAINT driver_profiles_check1 CHECK ((("emergencyContactName" IS NULL) = ("emergencyContactPhone" IS NULL))),
    CONSTRAINT driver_profiles_check2 CHECK ((((status)::text = 'active'::text) OR ("currentTruckId" IS NULL))),
    CONSTRAINT driver_profiles_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);

CREATE TABLE app.driver_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "driverId" uuid NOT NULL,
    "truckId" uuid NOT NULL,
    date date NOT NULL,
    "createdById" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "cancelledAt" timestamp with time zone,
    "cancelledById" uuid,
    note text DEFAULT ''::text NOT NULL
);

CREATE TABLE app.driver_truck_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "driverId" uuid NOT NULL,
    "truckId" uuid NOT NULL,
    "changedById" uuid,
    "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "endedAt" timestamp with time zone,
    CONSTRAINT driver_truck_assignments_check CHECK (("endedAt" >= "startedAt"))
);

CREATE TABLE app.driver_truck_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "driverId" uuid NOT NULL,
    "associationId" uuid NOT NULL,
    "kratosSessionId" uuid NOT NULL,
    "confirmedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE app.driving_sessions (
    id uuid NOT NULL,
    "driverId" uuid NOT NULL,
    "truckId" uuid NOT NULL,
    "kratosSessionId" uuid NOT NULL,
    "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "endedAt" timestamp with time zone,
    "endedById" uuid,
    "endReason" character varying(32),
    "confirmedDate" date NOT NULL,
    "scheduleId" uuid,
    CONSTRAINT driving_sessions_check CHECK ((("endedAt" IS NULL) OR ("endedAt" >= "startedAt")))
);

CREATE TABLE app.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(100) NOT NULL,
    name character varying(100) NOT NULL
);

CREATE TABLE app.role_permissions (
    "roleId" uuid NOT NULL,
    "permissionId" uuid NOT NULL
);

CREATE TABLE app.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(64) NOT NULL,
    name character varying(100) NOT NULL
);

CREATE TABLE app.tracking_events (
    id uuid NOT NULL,
    "streamId" uuid NOT NULL,
    sequence integer NOT NULL,
    kind character varying(16) NOT NULL,
    "recordedAt" timestamp with time zone NOT NULL,
    "receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
    latitude double precision,
    longitude double precision,
    accuracy double precision,
    speed double precision,
    heading double precision,
    mocked boolean,
    digest character varying(64) NOT NULL,
    raw jsonb NOT NULL,
    CONSTRAINT tracking_events_kind_check CHECK (((kind)::text = ANY ((ARRAY['location'::character varying, 'status'::character varying])::text[]))),
    CONSTRAINT tracking_events_latitude_check CHECK (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))),
    CONSTRAINT tracking_events_longitude_check CHECK (((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))),
    CONSTRAINT tracking_events_sequence_check CHECK ((sequence > 0))
);

CREATE TABLE app.tracking_streams (
    id uuid NOT NULL,
    "deviceId" uuid,
    "driverId" uuid NOT NULL,
    "associationId" uuid,
    "kratosSessionId" uuid NOT NULL,
    "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "endedAt" timestamp with time zone,
    "finalSequence" integer,
    "drivingSessionId" uuid,
    "uploadTokenHash" character varying(64),
    CONSTRAINT ck_tracking_source CHECK (((("drivingSessionId" IS NOT NULL) AND ("uploadTokenHash" IS NOT NULL) AND ("deviceId" IS NULL) AND ("associationId" IS NULL)) OR (("drivingSessionId" IS NULL) AND ("uploadTokenHash" IS NULL) AND ("deviceId" IS NOT NULL) AND ("associationId" IS NOT NULL)))),
    CONSTRAINT "tracking_streams_finalSequence_check" CHECK (("finalSequence" >= 0))
);

CREATE TABLE app.truck_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier character varying(80) NOT NULL,
    "serialNumber" character varying(100),
    "currentTruckId" uuid,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "credentialHash" character varying(64),
    "enrolledAt" timestamp with time zone,
    "lastSeenAt" timestamp with time zone,
    "enrolledById" uuid
);

CREATE TABLE app.trucks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier character varying(40) NOT NULL,
    registration character varying(30) NOT NULL,
    "registrationCountry" character varying(2) NOT NULL,
    make character varying(80) NOT NULL,
    model character varying(80) NOT NULL,
    year integer,
    vin character varying(17),
    "engineNumber" character varying(80),
    category character varying(30) NOT NULL,
    "fuelType" character varying(20) NOT NULL,
    transmission character varying(20),
    "axleCount" integer,
    "grossVehicleMassKg" integer,
    "tareKg" integer,
    "payloadCapacityKg" integer,
    "odometerKm" integer NOT NULL,
    "tankCapacityLitres" integer,
    "licenceDiscExpiresOn" date,
    "roadworthyExpiresOn" date,
    "insuranceProvider" character varying(100),
    "insurancePolicyNumber" character varying(100),
    "insuranceExpiresOn" date,
    "serviceIntervalKm" integer,
    "nextServiceDueKm" integer,
    status character varying(20) NOT NULL,
    notes text,
    "createdById" uuid,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "trucks_axleCount_check" CHECK ((("axleCount" >= 2) AND ("axleCount" <= 20))),
    CONSTRAINT trucks_category_check CHECK (((category)::text = ANY ((ARRAY['rigid'::character varying, 'tractor'::character varying, 'tipper'::character varying, 'tanker'::character varying, 'flatbed'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT trucks_check CHECK (("tareKg" <= "grossVehicleMassKg")),
    CONSTRAINT trucks_check1 CHECK (("payloadCapacityKg" <= "grossVehicleMassKg")),
    CONSTRAINT trucks_check2 CHECK ((("tareKg" + "payloadCapacityKg") <= "grossVehicleMassKg")),
    CONSTRAINT "trucks_fuelType_check" CHECK ((("fuelType")::text = ANY ((ARRAY['diesel'::character varying, 'petrol'::character varying, 'electric'::character varying, 'hybrid'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT "trucks_grossVehicleMassKg_check" CHECK (("grossVehicleMassKg" > 0)),
    CONSTRAINT "trucks_nextServiceDueKm_check" CHECK (("nextServiceDueKm" >= 0)),
    CONSTRAINT "trucks_odometerKm_check" CHECK (("odometerKm" >= 0)),
    CONSTRAINT "trucks_payloadCapacityKg_check" CHECK (("payloadCapacityKg" > 0)),
    CONSTRAINT "trucks_serviceIntervalKm_check" CHECK (("serviceIntervalKm" > 0)),
    CONSTRAINT trucks_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'maintenance'::character varying, 'inactive'::character varying])::text[]))),
    CONSTRAINT "trucks_tankCapacityLitres_check" CHECK (("tankCapacityLitres" > 0)),
    CONSTRAINT "trucks_tareKg_check" CHECK (("tareKg" > 0)),
    CONSTRAINT trucks_transmission_check CHECK (((transmission)::text = ANY ((ARRAY['manual'::character varying, 'automatic'::character varying, 'automated'::character varying])::text[]))),
    CONSTRAINT trucks_year_check CHECK (((year >= 1950) AND (year <= 2200)))
);

CREATE TABLE app.user_roles (
    "userId" uuid NOT NULL,
    "roleId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE app.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "kratosIdentityId" uuid NOT NULL,
    email character varying(320) NOT NULL,
    "firstName" character varying(100) NOT NULL,
    "lastName" character varying(100) NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdById" uuid,
    "lastLoginAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_users_email_normalized CHECK (((email)::text = lower(TRIM(BOTH FROM email))))
);

CREATE TABLE app.vehicle_disputes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "truckId" uuid NOT NULL,
    "driverId" uuid NOT NULL,
    "activeSessionId" uuid,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "resolvedAt" timestamp with time zone,
    "resolvedById" uuid,
    resolution character varying(32),
    note text,
    kind character varying(24) DEFAULT 'occupancy'::character varying NOT NULL,
    "scheduleId" uuid,
    "scheduleDate" date,
    "requestedTruckId" uuid,
    "driverNote" text,
    CONSTRAINT ck_dispute_kind CHECK (((((kind)::text = 'occupancy'::text) AND ("activeSessionId" IS NOT NULL) AND ("scheduleId" IS NULL)) OR (((kind)::text = 'schedule'::text) AND ("scheduleId" IS NOT NULL) AND ("scheduleDate" IS NOT NULL)))),
    CONSTRAINT ck_dispute_resolution CHECK (((resolution IS NULL) OR ((resolution)::text = ANY ((ARRAY['keep_current'::character varying, 'release_vehicle'::character varying, 'keep_schedule'::character varying, 'change_schedule'::character varying])::text[]))))
);

ALTER TABLE ONLY app.device_truck_associations
    ADD CONSTRAINT device_truck_associations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.driver_issues
    ADD CONSTRAINT driver_issues_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT "driver_profiles_currentTruckId_key" UNIQUE ("currentTruckId");

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT driver_profiles_identifier_key UNIQUE (identifier);

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT "driver_profiles_licenceCountry_licenceNumber_key" UNIQUE ("licenceCountry", "licenceNumber");

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT driver_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT "driver_profiles_userId_key" UNIQUE ("userId");

ALTER TABLE ONLY app.driver_schedules
    ADD CONSTRAINT driver_schedules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.driver_truck_assignments
    ADD CONSTRAINT driver_truck_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.driver_truck_confirmations
    ADD CONSTRAINT driver_truck_confirmations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.driving_sessions
    ADD CONSTRAINT driving_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.permissions
    ADD CONSTRAINT permissions_key_key UNIQUE (key);

ALTER TABLE ONLY app.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY ("roleId", "permissionId");

ALTER TABLE ONLY app.roles
    ADD CONSTRAINT roles_key_key UNIQUE (key);

ALTER TABLE ONLY app.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.tracking_events
    ADD CONSTRAINT tracking_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.tracking_streams
    ADD CONSTRAINT tracking_streams_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.truck_devices
    ADD CONSTRAINT "truck_devices_credentialHash_key" UNIQUE ("credentialHash");

ALTER TABLE ONLY app.truck_devices
    ADD CONSTRAINT "truck_devices_currentTruckId_key" UNIQUE ("currentTruckId");

ALTER TABLE ONLY app.truck_devices
    ADD CONSTRAINT truck_devices_identifier_key UNIQUE (identifier);

ALTER TABLE ONLY app.truck_devices
    ADD CONSTRAINT truck_devices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.truck_devices
    ADD CONSTRAINT "truck_devices_serialNumber_key" UNIQUE ("serialNumber");

ALTER TABLE ONLY app.trucks
    ADD CONSTRAINT trucks_identifier_key UNIQUE (identifier);

ALTER TABLE ONLY app.trucks
    ADD CONSTRAINT trucks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.trucks
    ADD CONSTRAINT trucks_registration_key UNIQUE (registration);

ALTER TABLE ONLY app.trucks
    ADD CONSTRAINT trucks_vin_key UNIQUE (vin);

ALTER TABLE ONLY app.driver_truck_confirmations
    ADD CONSTRAINT uq_driver_session_truck_confirmation UNIQUE ("kratosSessionId", "associationId");

ALTER TABLE ONLY app.tracking_events
    ADD CONSTRAINT uq_tracking_stream_sequence UNIQUE ("streamId", sequence);

ALTER TABLE ONLY app.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY ("userId", "roleId");

ALTER TABLE ONLY app.users
    ADD CONSTRAINT "users_kratosIdentityId_key" UNIQUE ("kratosIdentityId");

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY app.vehicle_disputes
    ADD CONSTRAINT vehicle_disputes_pkey PRIMARY KEY (id);

CREATE INDEX idx_device_association_history ON app.device_truck_associations USING btree ("truckId", "startedAt");

CREATE INDEX idx_driver_assignment_history ON app.driver_truck_assignments USING btree ("driverId", "startedAt");

CREATE INDEX idx_tracking_driving_session ON app.tracking_streams USING btree ("drivingSessionId");

CREATE INDEX idx_tracking_event_time ON app.tracking_events USING btree ("recordedAt", id);

CREATE INDEX idx_tracking_stream_device ON app.tracking_streams USING btree ("deviceId", "startedAt");

CREATE INDEX idx_user_roles_role ON app.user_roles USING btree ("roleId");

CREATE INDEX idx_vehicle_dispute_open ON app.vehicle_disputes USING btree ("createdAt") WHERE ("resolvedAt" IS NULL);

CREATE INDEX ix_driver_issues_driver ON app.driver_issues USING btree ("driverId", "createdAt" DESC);

CREATE INDEX ix_driver_issues_open ON app.driver_issues USING btree ("createdAt" DESC, id DESC) WHERE ("resolvedAt" IS NULL);

CREATE UNIQUE INDEX uq_device_current_association ON app.device_truck_associations USING btree ("deviceId") WHERE ("endedAt" IS NULL);

CREATE UNIQUE INDEX uq_driver_current_assignment ON app.driver_truck_assignments USING btree ("driverId") WHERE ("endedAt" IS NULL);

CREATE UNIQUE INDEX uq_driving_active_driver ON app.driving_sessions USING btree ("driverId") WHERE ("endedAt" IS NULL);

CREATE UNIQUE INDEX uq_driving_active_truck ON app.driving_sessions USING btree ("truckId") WHERE ("endedAt" IS NULL);

CREATE UNIQUE INDEX uq_schedule_driver_day ON app.driver_schedules USING btree ("driverId", date) WHERE ("cancelledAt" IS NULL);

CREATE UNIQUE INDEX uq_schedule_open_dispute ON app.vehicle_disputes USING btree ("driverId", "scheduleDate") WHERE (("resolvedAt" IS NULL) AND ((kind)::text = 'schedule'::text));

CREATE UNIQUE INDEX uq_schedule_truck_day ON app.driver_schedules USING btree ("truckId", date) WHERE ("cancelledAt" IS NULL);

CREATE UNIQUE INDEX uq_tracking_upload_token ON app.tracking_streams USING btree ("uploadTokenHash") WHERE ("uploadTokenHash" IS NOT NULL);

CREATE UNIQUE INDEX uq_truck_current_assignment ON app.driver_truck_assignments USING btree ("truckId") WHERE ("endedAt" IS NULL);

CREATE UNIQUE INDEX uq_truck_current_device ON app.device_truck_associations USING btree ("truckId") WHERE ("endedAt" IS NULL);

CREATE UNIQUE INDEX uq_users_email ON app.users USING btree (email);

CREATE UNIQUE INDEX uq_vehicle_open_dispute ON app.vehicle_disputes USING btree ("truckId", "driverId") WHERE (("resolvedAt" IS NULL) AND ((kind)::text = 'occupancy'::text));

ALTER TABLE ONLY app.device_truck_associations
    ADD CONSTRAINT "device_truck_associations_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES app.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY app.device_truck_associations
    ADD CONSTRAINT "device_truck_associations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES app.truck_devices(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.device_truck_associations
    ADD CONSTRAINT "device_truck_associations_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES app.trucks(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driver_issues
    ADD CONSTRAINT "driver_issues_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES app.driver_profiles(id);

ALTER TABLE ONLY app.driver_issues
    ADD CONSTRAINT "driver_issues_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES app.users(id);

ALTER TABLE ONLY app.driver_issues
    ADD CONSTRAINT "driver_issues_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES app.trucks(id);

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT "driver_profiles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES app.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT "driver_profiles_currentTruckId_fkey" FOREIGN KEY ("currentTruckId") REFERENCES app.trucks(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driver_profiles
    ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES app.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driver_schedules
    ADD CONSTRAINT "driver_schedules_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES app.users(id);

ALTER TABLE ONLY app.driver_schedules
    ADD CONSTRAINT "driver_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES app.users(id);

ALTER TABLE ONLY app.driver_schedules
    ADD CONSTRAINT "driver_schedules_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES app.driver_profiles(id);

ALTER TABLE ONLY app.driver_schedules
    ADD CONSTRAINT "driver_schedules_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES app.trucks(id);

ALTER TABLE ONLY app.driver_truck_assignments
    ADD CONSTRAINT "driver_truck_assignments_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES app.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY app.driver_truck_assignments
    ADD CONSTRAINT "driver_truck_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES app.driver_profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driver_truck_assignments
    ADD CONSTRAINT "driver_truck_assignments_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES app.trucks(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driver_truck_confirmations
    ADD CONSTRAINT "driver_truck_confirmations_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES app.device_truck_associations(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driver_truck_confirmations
    ADD CONSTRAINT "driver_truck_confirmations_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES app.driver_profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driving_sessions
    ADD CONSTRAINT "driving_sessions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES app.driver_profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driving_sessions
    ADD CONSTRAINT "driving_sessions_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES app.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.driving_sessions
    ADD CONSTRAINT "driving_sessions_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES app.driver_schedules(id);

ALTER TABLE ONLY app.driving_sessions
    ADD CONSTRAINT "driving_sessions_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES app.trucks(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.role_permissions
    ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES app.permissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY app.role_permissions
    ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES app.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY app.tracking_events
    ADD CONSTRAINT "tracking_events_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES app.tracking_streams(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.tracking_streams
    ADD CONSTRAINT "tracking_streams_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES app.device_truck_associations(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.tracking_streams
    ADD CONSTRAINT "tracking_streams_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES app.truck_devices(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.tracking_streams
    ADD CONSTRAINT "tracking_streams_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES app.driver_profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.tracking_streams
    ADD CONSTRAINT "tracking_streams_drivingSessionId_fkey" FOREIGN KEY ("drivingSessionId") REFERENCES app.driving_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.truck_devices
    ADD CONSTRAINT "truck_devices_currentTruckId_fkey" FOREIGN KEY ("currentTruckId") REFERENCES app.trucks(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.truck_devices
    ADD CONSTRAINT "truck_devices_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES app.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY app.trucks
    ADD CONSTRAINT "trucks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES app.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY app.user_roles
    ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES app.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY app.user_roles
    ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES app.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY app.users
    ADD CONSTRAINT "users_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES app.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY app.vehicle_disputes
    ADD CONSTRAINT "vehicle_disputes_activeSessionId_fkey" FOREIGN KEY ("activeSessionId") REFERENCES app.driving_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.vehicle_disputes
    ADD CONSTRAINT "vehicle_disputes_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES app.driver_profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.vehicle_disputes
    ADD CONSTRAINT "vehicle_disputes_requestedTruckId_fkey" FOREIGN KEY ("requestedTruckId") REFERENCES app.trucks(id);

ALTER TABLE ONLY app.vehicle_disputes
    ADD CONSTRAINT "vehicle_disputes_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES app.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY app.vehicle_disputes
    ADD CONSTRAINT "vehicle_disputes_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES app.driver_schedules(id);

ALTER TABLE ONLY app.vehicle_disputes
    ADD CONSTRAINT "vehicle_disputes_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES app.trucks(id) ON DELETE RESTRICT;
`;
