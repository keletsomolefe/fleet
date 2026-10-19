import {
  TrucksController,
  DriversController,
} from '../fleet/fleet.controller.js';
import { FleetService } from '../fleet/fleet.service.js';
import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { AdminUsersController } from '../users/admin-users.controller.js';
import { AdminUsersService } from '../users/admin-users.service.js';
import { AuthController } from './auth.controller.js';
import { AuthMiddleware } from './auth.middleware.js';
import { AuthService } from './auth.service.js';
import { KratosHookController } from './kratos-hook.controller.js';
import { KratosService } from './kratos.service.js';
import {
  Permission,
  Role,
  RolePermission,
  UserRole,
} from '../rbac/rbac.entity.js';
import { RbacService } from '../rbac/rbac.service.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RolesController } from '../rbac/roles.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Permission,
      Role,
      RolePermission,
      UserRole,
    ]),
  ],
  controllers: [
    AuthController,
    TrucksController,
    DriversController,
    AdminUsersController,
    KratosHookController,
    RolesController,
  ],
  providers: [
    AuthService,
    FleetService,
    AuthMiddleware,
    KratosService,
    AdminUsersService,
    RbacService,
    PermissionsGuard,
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes(
        { path: 'auth/session', method: RequestMethod.ALL },
        { path: 'admin', method: RequestMethod.ALL },
        { path: 'admin/{*path}', method: RequestMethod.ALL },
      );
  }
}
