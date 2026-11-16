import { Database, EntityManager } from './database/database.js';
import 'reflect-metadata';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { FastifyServerOptions } from 'fastify';
import {
  type MikroORM,
  MikroORM as MikroOrm,
  RequestContext,
} from '@mikro-orm/postgresql';
import { protectAdminRoutes } from './auth/admin-session.js';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { AuthService } from './auth/auth.service.js';
import { registerKratosHook } from './auth/kratos-hook.routes.js';
import { KratosService } from './auth/kratos.service.js';
import { databaseConfig } from './database/database.config.js';
import {
  registerDriverRoutes,
  registerTruckRoutes,
} from './fleet/fleet.routes.js';
import { FleetService } from './fleet/fleet.service.js';
import { privateResponse } from './http/request.js';
import { createHttpServer, sendNotFound } from './http/server.js';
import {
  registerAdminIssueRoutes,
  registerMobileIssueRoutes,
} from './issues/issues.routes.js';
import { IssuesService } from './issues/issues.service.js';
import { registerAdminRepairRoutes } from './issues/repairs.routes.js';
import { RepairsService } from './issues/repairs.service.js';
import {
  registerAdminVehicleDisputeRoutes,
  registerMobileDrivingRoutes,
} from './mobile/driving.routes.js';
import { DrivingService } from './mobile/driving.service.js';
import { MobileAuthService } from './mobile/mobile-auth.service.js';
import { registerMobileAuthRoutes } from './mobile/mobile.routes.js';
import { OperationsEventsService } from './operations/operations-events.service.js';
import { UserRole, Role } from './rbac/rbac.entity.js';
import { ServiceJobAccess } from './service-jobs/service-job-access.js';
import { ServiceJobsService } from './service-jobs/service-jobs.service.js';
import {
  registerAdminServiceJobRoutes,
  registerPublicServiceJobRoutes,
} from './service-jobs/service-jobs.routes.js';
import { RbacService } from './rbac/rbac.service.js';
import { registerRoleRoutes } from './rbac/roles.routes.js';
import {
  registerAdminNotificationRoutes,
  registerAdminScheduleRoutes,
  registerMobileScheduleRoutes,
} from './scheduling/scheduling.routes.js';
import { SchedulingService } from './scheduling/scheduling.service.js';
import { FleetMqttService } from './telemetry/mqtt.service.js';
import {
  registerAdminTelemetryRoutes,
  registerMobileTelemetryRoutes,
} from './telemetry/telemetry.routes.js';
import { TelemetryService } from './telemetry/telemetry.service.js';
import { registerAdminUserRoutes } from './users/admin-users.routes.js';
import { AdminUsersService } from './users/admin-users.service.js';
import { User } from './users/user.entity.js';
import { JobAlertWorker } from './whatsapp/job-alert.worker.js';
import { WhatsAppCloudService } from './whatsapp/whatsapp-cloud.service.js';
import { WhatsAppWebhookService } from './whatsapp/whatsapp-webhook.service.js';
import { registerWhatsAppWebhookRoutes } from './whatsapp/whatsapp-webhook.routes.js';

type ApiOptions = FastifyServerOptions & {
  database?: Database;
  orm?: MikroORM;
};

export async function createApi({
  database,
  orm,
  ...serverOptions
}: ApiOptions = {}): Promise<{
  app: ReturnType<typeof createHttpServer>;
  services: {
    orm: MikroORM;
    database: Database;
    events: OperationsEventsService;
    repairs: RepairsService;
    serviceJobs: ServiceJobsService;
    alertWorker: JobAlertWorker;
    whatsapp: WhatsAppCloudService;
  };
}> {
  const mikro = orm ?? (await MikroOrm.init(databaseConfig() as never));
  const db = database ?? new Database(mikro);
  const app = createHttpServer(serverOptions);
  const users = db.getRepository(User);
  const kratos = new KratosService();
  const rbac = new RbacService(
    db.getRepository(UserRole),
    db.getRepository(Role),
  );
  const auth = new AuthService(kratos, users, rbac);
  const adminUsers = new AdminUsersService(
    users,
    kratos,
    db,
    rbac,
    app.log.child({ service: 'users' }),
  );
  const fleet = new FleetService(db, adminUsers, rbac);
  const events = new OperationsEventsService(db, auth);
  const schedules = new SchedulingService(db, events);
  const driving = new DrivingService(db, schedules, events);
  const telemetry = new TelemetryService(db, driving, kratos);
  const mqtt = new FleetMqttService(
    telemetry,
    events,
    app.log.child({ service: 'mqtt' }),
  );
  const mobileAuth = new MobileAuthService(
    db,
    kratos,
    auth,
    rbac,
    driving,
  );
  const serviceJobAccess = new ServiceJobAccess();
  const serviceJobs = new ServiceJobsService(
    db,
    events,
    serviceJobAccess,
    app.log.child({ service: 'service-jobs' }),
  );
  const whatsapp = new WhatsAppCloudService(
    app.log.child({ service: 'whatsapp' }),
  );
  const alertWorker = new JobAlertWorker(
    db,
    serviceJobs,
    whatsapp,
    app.log.child({ service: 'job-alerts' }),
  );
  const whatsappWebhook = new WhatsAppWebhookService(
    db,
    serviceJobs,
    whatsapp,
    app.log.child({ service: 'whatsapp-webhook' }),
  );
  serviceJobs.onAlertsQueued = () => alertWorker.wake();
  const repairs = new RepairsService(db, events);
  const issues = new IssuesService(db, driving, events, serviceJobs);

  // Every HTTP request gets its own MikroORM EntityManager. The global
  // EntityManager stays disabled (allowGlobalContext: false).
  app.addHook('onRequest', (_request, _reply, done) => {
    RequestContext.create(mikro.em, done);
  });

  app.addHook('onReady', async () => {
    await alertWorker.start();
    whatsappWebhook.start();
    await mqtt.start();
  });
  app.addHook('onClose', async () => {
    alertWorker.stop();
    whatsappWebhook.stop();
    try {
      await mqtt.stop();
    } finally {
      await db.destroy();
    }
  });

  app.decorateRequest('adminContext', null);
  app.register(cookie);
  app.get('/', async () => 'Hello World!');
  registerAuthRoutes(app, auth);
  registerKratosHook(app, users);
  registerWhatsAppWebhookRoutes(app, whatsappWebhook);

  app.register(
    async (admin) => {
      protectAdminRoutes(admin, auth, rbac);
      admin.setNotFoundHandler(sendNotFound);
      registerAdminUserRoutes(admin, auth, adminUsers);
      registerRoleRoutes(admin, rbac);
      registerTruckRoutes(admin, fleet);
      registerDriverRoutes(admin, fleet);
      registerAdminIssueRoutes(admin, issues);
      registerAdminServiceJobRoutes(admin, serviceJobs);
      admin.register(async (repair) => {
        repair.register(multipart);
        registerAdminRepairRoutes(repair, repairs);
      });
      registerAdminScheduleRoutes(admin, schedules);
      registerAdminNotificationRoutes(admin, events);
      registerAdminVehicleDisputeRoutes(admin, driving);
      registerAdminTelemetryRoutes(admin, telemetry);
    },
    { prefix: '/admin' },
  );
  app.register(async (mobile) => {
    mobile.addHook('onRequest', privateResponse);
    registerMobileAuthRoutes(mobile, auth, mobileAuth);
    registerMobileDrivingRoutes(mobile, auth, driving);
    registerMobileIssueRoutes(mobile, auth, issues);
    registerMobileScheduleRoutes(mobile, schedules, events, auth);
    registerMobileTelemetryRoutes(mobile, auth, telemetry);
  });
  app.register(async (publicJobs) => {
    publicJobs.register(multipart);
    registerPublicServiceJobRoutes(publicJobs, serviceJobs);
  });

  return {
    app,
    services: {
      orm: mikro,
      database: db,
      events,
      repairs,
      serviceJobs,
      alertWorker,
      whatsapp,
    },
  };
}
