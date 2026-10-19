import { DriverTruckConfirmation } from '../mobile/mobile.entity.js';
import { MobileDeviceEnrollment1792368004000 } from './migrations/1792368004000-MobileDeviceEnrollment.js';
import { fleetEntities } from '../fleet/fleet.entity.js';
import { FleetProfiles1792368003000 } from './migrations/1792368003000-FleetProfiles.js';
import type { DataSourceOptions } from 'typeorm';
import { User } from '../users/user.entity.js';
import { CreateUsers1792368000000 } from './migrations/1792368000000-CreateUsers.js';
import { UserRoles1792368001000 } from './migrations/1792368001000-UserRoles.js';
import { AdminAccess1792368002000 } from './migrations/1792368002000-AdminAccess.js';
import {
  Permission,
  Role,
  RolePermission,
  UserRole,
} from '../rbac/rbac.entity.js';

export function databaseOptions(maintenance = false): DataSourceOptions {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required. Run pnpm dev:setup.');
  if (process.env.DATABASE_SCHEMA && process.env.DATABASE_SCHEMA !== 'app') {
    throw new Error('Fleet application data must use the app schema.');
  }
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    schema: 'app',
    entities: [
      ...fleetEntities,
      DriverTruckConfirmation,
      User,
      Permission,
      Role,
      RolePermission,
      UserRole,
    ],
    migrations: [
      CreateUsers1792368000000,
      UserRoles1792368001000,
      AdminAccess1792368002000,
      FleetProfiles1792368003000,
      MobileDeviceEnrollment1792368004000,
    ],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    migrationsRun: false,
    logging: false,
    installExtensions: false,
    uuidExtension: 'pgcrypto',
    extra: {
      max: maintenance ? 2 : 8,
      min: 0,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      application_name: maintenance ? 'fleet-maintenance' : 'fleet-api',
    },
  };
}
