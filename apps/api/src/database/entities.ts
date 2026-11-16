// Explicit entity list used when folder-based discovery cannot load TypeScript
// sources (vitest transform contexts). Runtime and CLI use the configured
// `dist/**/*.entity.js` / `src/**/*.entity.ts` globs instead.
import {
  DeviceTruckAssociation,
  DriverProfile,
  DriverTruckAssignment,
  Truck,
  TruckDevice,
} from '../fleet/fleet.entity.js';
import { DriverIssue } from '../issues/issue.entity.js';
import { DriverTruckConfirmation } from '../mobile/mobile.entity.js';
import { DrivingSession, VehicleDispute } from '../mobile/driving.entity.js';
import {
  Permission,
  Role,
  RolePermission,
  UserRole,
} from '../rbac/rbac.entity.js';
import { DriverSchedule } from '../scheduling/schedule.entity.js';
import { ServiceProvider } from '../service-jobs/service-provider.entity.js';
import {
  ServiceJob,
  ServiceJobAttachment,
  ServiceJobEvent,
  ServiceJobOffer,
} from '../service-jobs/service-job.entity.js';
import {
  TrackingEvent,
  TrackingStream,
} from '../telemetry/telemetry.entity.js';
import { User } from '../users/user.entity.js';
import { WhatsAppMessage } from '../whatsapp/whatsapp-message.entity.js';

export const appEntities = [
  Truck,
  TruckDevice,
  DriverProfile,
  DriverTruckAssignment,
  DeviceTruckAssociation,
  DriverIssue,
  DriverTruckConfirmation,
  DrivingSession,
  VehicleDispute,
  DriverSchedule,
  Permission,
  Role,
  RolePermission,
  UserRole,
  ServiceProvider,
  ServiceJob,
  ServiceJobOffer,
  ServiceJobEvent,
  ServiceJobAttachment,
  TrackingStream,
  TrackingEvent,
  User,
  WhatsAppMessage,
];
