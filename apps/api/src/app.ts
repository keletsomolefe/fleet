import 'reflect-metadata';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { FastifyServerOptions } from 'fastify';
import { DataSource } from 'typeorm';
import { protectAdminRoutes } from './auth/admin-session.js';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { AuthService } from './auth/auth.service.js';
import { registerKratosHook } from './auth/kratos-hook.routes.js';
import { KratosService } from './auth/kratos.service.js';
import { databaseOptions } from './database/database.config.js';
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
import { OpenWaService } from './issues/openwa.service.js';
import { RepairAccess } from './issues/repair-access.js';
import { RepairOtpService } from './issues/repair-otp.service.js';
import {
  registerAdminRepairRoutes,
  registerPublicRepairRoutes,
} from './issues/repairs.routes.js';
import { RepairsService } from './issues/repairs.service.js';
import {
  registerAdminVehicleDisputeRoutes,
  registerMobileDrivingRoutes,
} from './mobile/driving.routes.js';
import { DrivingService } from './mobile/driving.service.js';
import { MobileAuthService } from './mobile/mobile-auth.service.js';
import { registerMobileAuthRoutes } from './mobile/mobile.routes.js';
import { OperationsEventsService } from './operations/operations-events.service.js';
import { Role, UserRole } from './rbac/rbac.entity.js';
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

type ApiOptions = FastifyServerOptions & { database?: DataSource };

export function createApi({
  database = new DataSource(databaseOptions()),
  ...serverOptions
}: ApiOptions = {}) {
  const app = createHttpServer(serverOptions);
  const users = database.getRepository(User);
  const kratos = new KratosService();
  const rbac = new RbacService(
    database.getRepository(UserRole),
    database.getRepository(Role),
  );
  const auth = new AuthService(kratos, users, rbac);
  const adminUsers = new AdminUsersService(
    users,
    kratos,
    database,
    rbac,
    app.log.child({ service: 'users' }),
  );
  const fleet = new FleetService(database, adminUsers, rbac);
  const events = new OperationsEventsService(database, auth);
  const schedules = new SchedulingService(database, events);
  const driving = new DrivingService(database, schedules, events);
  const telemetry = new TelemetryService(database, driving, kratos);
  const mqtt = new FleetMqttService(
    telemetry,
    events,
    app.log.child({ service: 'mqtt' }),
  );
  const mobileAuth = new MobileAuthService(
    database,
    kratos,
    auth,
    rbac,
    driving,
  );
  const repairAccess = new RepairAccess();
  const openWa = new OpenWaService(
    database,
    repairAccess,
    app.log.child({ service: 'openwa' }),
  );
  const repairOtp = new RepairOtpService(openWa, repairAccess);
  const repairs = new RepairsService(database, repairOtp, events);
  const issues = new IssuesService(database, driving, events, openWa);

  app.addHook('onReady', async () => {
    if (!database.isInitialized) await database.initialize();
    await openWa.start();
    await mqtt.start();
  });
  app.addHook('onClose', async () => {
    openWa.stop();
    try {
      await mqtt.stop();
    } finally {
      if (database.isInitialized) await database.destroy();
    }
  });

  app.decorateRequest('adminContext', null);
  app.register(cookie);
  app.get('/', async () => 'Hello World!');
  registerAuthRoutes(app, auth);
  registerKratosHook(app, users);

  app.register(
    async (admin) => {
      protectAdminRoutes(admin, auth, rbac);
      admin.setNotFoundHandler(sendNotFound);
      registerAdminUserRoutes(admin, auth, adminUsers);
      registerRoleRoutes(admin, rbac);
      registerTruckRoutes(admin, fleet);
      registerDriverRoutes(admin, fleet);
      registerAdminIssueRoutes(admin, issues);
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
  app.register(async (publicRepairs) => {
    publicRepairs.register(multipart);
    registerPublicRepairRoutes(publicRepairs, repairs, repairAccess, repairOtp);
  });

  return { app, services: { database, openWa, events, repairs } };
}
