import { LaunchBaseline1793188800000 } from './migrations/1793188800000-LaunchBaseline.js';
import { transportEntities } from '../transport/transport.entity.js';
import { DriverIssue } from '../issues/issue.entity.js';
import { DriverSchedule } from '../scheduling/schedule.entity.js';
import { DriverTruckConfirmation } from '../mobile/mobile.entity.js';
import { DrivingSession, VehicleDispute } from '../mobile/driving.entity.js';
import {
  TrackingEvent,
  TrackingStream,
} from '../telemetry/telemetry.entity.js';
import { fleetEntities } from '../fleet/fleet.entity.js';
import type { DataSourceOptions } from 'typeorm';
import { User } from '../users/user.entity.js';
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
      ...transportEntities,
      DriverTruckConfirmation,
      DrivingSession,
      DriverSchedule,
      VehicleDispute,
      DriverIssue,
      TrackingStream,
      TrackingEvent,
      User,
      Permission,
      Role,
      RolePermission,
      UserRole,
    ],
    migrations: [LaunchBaseline1793188800000],
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
