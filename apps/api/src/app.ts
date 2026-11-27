import cookie from '@fastify/cookie';
import { MikroORM, type MikroORM as MikroOrmInstance } from '@mikro-orm/postgresql';
import type { FastifyServerOptions } from 'fastify';
import { databaseConfig } from './database/database.config.js';
import { DrivingService } from './modules/driving/application/driving.service.js';
import { MobileAuthService } from './modules/driving/application/mobile-auth.service.js';
import {
  adminShiftsPlugin,
  adminVehicleDisputesPlugin,
  mobileDrivingPlugin,
} from './modules/driving/http/driving.plugin.js';
import { mobileAuthPlugin } from './modules/driving/http/mobile-auth.plugin.js';
import { FleetService } from './modules/fleet/application/fleet.service.js';
import { fleetAdminPlugin } from './modules/fleet/http/fleet.plugin.js';
import { AdminUsersService } from './modules/identity/application/admin-users.service.js';
import { AuthService } from './modules/identity/application/auth.service.js';
import { RbacService } from './modules/identity/application/rbac.service.js';
import { adminUsersPlugin } from './modules/identity/http/admin-users.plugin.js';
import { authPlugin } from './modules/identity/http/auth.plugin.js';
import { kratosHookPlugin } from './modules/identity/http/kratos-hook.plugin.js';
import { KratosService } from './modules/identity/infrastructure/kratos.service.js';
import { IssuesService } from './modules/issues/application/issues.service.js';
import { RepairsService } from './modules/issues/application/repairs.service.js';
import {
  adminIssuesPlugin,
  mobileIssuesPlugin,
} from './modules/issues/http/issues.plugin.js';
import { adminRepairsPlugin } from './modules/issues/http/repairs.plugin.js';
import { OperationsEventsService } from './modules/operations/application/operations-events.service.js';
import {
  adminNotificationsPlugin,
  mobileNotificationsPlugin,
} from './modules/operations/http/notifications.plugin.js';
import { SchedulingService } from './modules/scheduling/application/scheduling.service.js';
import {
  adminSchedulingPlugin,
  mobileSchedulingPlugin,
} from './modules/scheduling/http/scheduling.plugin.js';
import { ServiceJobsService } from './modules/service-jobs/application/service-jobs.service.js';
import { serviceJobAccess } from './modules/service-jobs/domain/service-job-access.js';
import {
  adminServiceJobsPlugin,
  publicServiceJobsPlugin,
} from './modules/service-jobs/http/service-jobs.plugin.js';
import { TelemetryService } from './modules/telemetry/application/telemetry.service.js';
import {
  adminTelemetryPlugin,
  mobileTelemetryPlugin,
} from './modules/telemetry/http/telemetry.plugin.js';
import { FleetMqttService } from './modules/telemetry/infrastructure/mqtt.service.js';
import { ActivityService } from './modules/transport/application/activity.service.js';
import { CatalogueService } from './modules/transport/application/catalogue.service.js';
import { DispatchService } from './modules/transport/application/dispatch.service.js';
import { EarningsService } from './modules/transport/application/earnings.service.js';
import { ExpensesService } from './modules/transport/application/expenses.service.js';
import { PricingService } from './modules/transport/application/pricing.service.js';
import { ReportsService } from './modules/transport/application/reports.service.js';
import {
  adminTransportPlugin,
  mobileTransportPlugin,
  type TransportServices,
} from './modules/transport/http/transport.plugin.js';
import { JobAlertWorker } from './modules/whatsapp/application/job-alert.worker.js';
import { WhatsAppWebhookService } from './modules/whatsapp/application/whatsapp-webhook.service.js';
import { whatsappWebhookPlugin } from './modules/whatsapp/http/whatsapp-webhook.plugin.js';
import { createJobAlertSender } from './modules/whatsapp/infrastructure/job-alert-sender.js';
import { WhatsAppCloudService } from './modules/whatsapp/infrastructure/whatsapp-cloud.service.js';
import { protectAdminScope } from './plugins/admin-auth.plugin.js';
import { mikroOrmPlugin } from './plugins/mikro-orm.plugin.js';
import { mobileSessionHook } from './plugins/mobile-auth.plugin.js';
import { createHttpServer, sendNotFound } from './plugins/server.js';
import { privateResponse } from './shared/http.js';

type ApiOptions = FastifyServerOptions & {
  orm?: MikroOrmInstance;
};

export async function createApi({
  orm: providedOrm,
  ...serverOptions
}: ApiOptions = {}): Promise<{
  app: ReturnType<typeof createHttpServer>;
  services: {
    orm: MikroOrmInstance;
    events: OperationsEventsService;
    repairs: RepairsService;
    serviceJobs: ServiceJobsService;
    alertWorker: JobAlertWorker;
    whatsapp: WhatsAppCloudService;
    transport: TransportServices;
  };
}> {
  const orm = providedOrm ?? (await MikroORM.init(databaseConfig()));
  const app = createHttpServer(serverOptions);

  // Composition root: instantiate bounded-context services and workers.
  const kratos = new KratosService();
  const rbac = new RbacService(orm);
  const auth = new AuthService(kratos, orm, rbac);
  const adminUsers = new AdminUsersService(
    orm,
    kratos,
    rbac,
    app.log.child({ service: 'users' }),
  );
  const fleet = new FleetService(orm, adminUsers, rbac);
  const events = new OperationsEventsService(orm, auth);
  const schedules = new SchedulingService(orm, events);
  const driving = new DrivingService(orm, schedules, events);
  const telemetry = new TelemetryService(orm, driving, kratos);
  const mqtt = new FleetMqttService(
    telemetry,
    events,
    app.log.child({ service: 'mqtt' }),
  );
  const mobileAuth = new MobileAuthService(orm, kratos, auth, rbac, driving);
  const whatsapp = new WhatsAppCloudService(
    app.log.child({ service: 'whatsapp' }),
  );
  const alertSender = createJobAlertSender(whatsapp);
  const serviceJobs = new ServiceJobsService(
    orm,
    events,
    serviceJobAccess,
    alertSender,
  );
  const alertWorker = new JobAlertWorker(
    orm,
    serviceJobs,
    alertSender,
    app.log.child({ service: 'job-alerts' }),
  );
  const whatsappWebhook = new WhatsAppWebhookService(
    orm,
    serviceJobs,
    whatsapp,
    app.log.child({ service: 'whatsapp-webhook' }),
  );
  serviceJobs.onAlertsQueued = () => alertWorker.wake();
  const repairs = new RepairsService(orm, events);
  const issues = new IssuesService(orm, driving, events, serviceJobs);
  const catalogue = new CatalogueService(orm, events);
  const pricing = new PricingService(orm, events);
  const dispatch = new DispatchService(orm, events);
  const activity = new ActivityService(orm, pricing, events);
  const expenses = new ExpensesService(orm, events);
  const earnings = new EarningsService(orm);
  const reports = new ReportsService(orm, earnings, expenses);
  const transport: TransportServices = {
    catalogue,
    pricing,
    dispatch,
    activity,
    expenses,
    earnings,
    reports,
  };

  // Fastify root plugins & request decorations.
  app.decorateRequest('adminContext', null);
  app.decorateRequest('mobileContext', null);
  app.decorateRequest('mobileToken', null);
  app.decorateRequest('jobAccessCode', null);

  await app.register(mikroOrmPlugin, { orm });
  await app.register(cookie);

  app.addHook('onReady', async () => {
    await alertWorker.start();
    whatsappWebhook.start();
    await mqtt.start();
  });

  app.addHook('onClose', async () => {
    alertWorker.stop();
    whatsappWebhook.stop();
    await mqtt.stop();
  });

  // Public health check and top-level endpoints.
  app.get('/', async () => 'Hello World!');
  app.register(authPlugin, { auth });
  app.register(kratosHookPlugin, { orm });
  app.register(whatsappWebhookPlugin, { webhook: whatsappWebhook });

  // Encapsulated Administrator API scope (`/admin/*`).
  app.register(
    async (admin) => {
      protectAdminScope(admin, auth, rbac);
      admin.setNotFoundHandler(sendNotFound);
      admin.register(adminUsersPlugin, { auth, users: adminUsers, rbac });
      admin.register(fleetAdminPlugin, { fleet });
      admin.register(adminIssuesPlugin, { issues });
      admin.register(adminRepairsPlugin, { repairs });
      admin.register(adminServiceJobsPlugin, { jobs: serviceJobs });
      admin.register(adminSchedulingPlugin, { schedules });
      admin.register(adminNotificationsPlugin, { events });
      admin.register(adminVehicleDisputesPlugin, { driving });
      admin.register(adminShiftsPlugin, { driving });
      admin.register(adminTelemetryPlugin, { telemetry });
      admin.register(adminTransportPlugin, { transport });
    },
    { prefix: '/admin' },
  );

  // Encapsulated Mobile API scope (`/mobile/*`).
  app.register(async (mobile) => {
    mobile.addHook('onRequest', privateResponse);
    mobile.register(mobileAuthPlugin, { auth, mobileAuth });
    mobile.register(mobileTelemetryPlugin, { auth, telemetry });
    mobile.register(mobileTransportPlugin, { auth, transport });

    // Authenticated mobile routes share a single Bearer session hook.
    mobile.register(async (authenticated) => {
      authenticated.addHook('preHandler', mobileSessionHook(auth));
      authenticated.register(mobileDrivingPlugin, { driving });
      authenticated.register(mobileIssuesPlugin, { issues });
      authenticated.register(mobileSchedulingPlugin, { schedules });
      authenticated.register(mobileNotificationsPlugin, { events });
    });
  });

  // Encapsulated Public Service-Job Link scope (`/public/service-job/*`).
  app.register(publicServiceJobsPlugin, { jobs: serviceJobs });

  return {
    app,
    services: {
      orm,
      events,
      repairs,
      serviceJobs,
      alertWorker,
      whatsapp,
      transport,
    },
  };
}
