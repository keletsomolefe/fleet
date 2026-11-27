// Explicit entity list used when folder-based discovery cannot load TypeScript
// sources (vitest transform contexts). Runtime and CLI use the configured
// `dist/**/*.entity.js` / `src/**/*.entity.ts` globs instead.
import { DriverTruckConfirmation } from '../modules/driving/domain/driver-truck-confirmation.entity.js';
import { DrivingSession } from '../modules/driving/domain/driving-session.entity.js';
import { VehicleDispute } from '../modules/driving/domain/vehicle-dispute.entity.js';
import { DriverTruckAssignment } from '../modules/fleet/domain/assignment.entity.js';
import {
  DeviceTruckAssociation,
  TruckDevice,
} from '../modules/fleet/domain/device.entity.js';
import { DriverProfile } from '../modules/fleet/domain/driver.entity.js';
import { Truck } from '../modules/fleet/domain/truck.entity.js';
import {
  Permission,
  Role,
  RolePermission,
  UserRole,
} from '../modules/identity/domain/rbac.entity.js';
import { User } from '../modules/identity/domain/user.entity.js';
import { DriverIssue } from '../modules/issues/domain/driver-issue.entity.js';
import { DriverSchedule } from '../modules/scheduling/domain/driver-schedule.entity.js';
import { ServiceJobAttachment } from '../modules/service-jobs/domain/service-job-attachment.entity.js';
import { ServiceJobEvent } from '../modules/service-jobs/domain/service-job-event.entity.js';
import { ServiceJobOffer } from '../modules/service-jobs/domain/service-job-offer.entity.js';
import { ServiceJob } from '../modules/service-jobs/domain/service-job.entity.js';
import { ServiceProvider } from '../modules/service-jobs/domain/service-provider.entity.js';
import { TrackingEvent } from '../modules/telemetry/domain/tracking-event.entity.js';
import { TrackingStream } from '../modules/telemetry/domain/tracking-stream.entity.js';
import {
  ActivityRevision,
  RecordingContext,
  TransportAttachment,
  TransportAudit,
  TransportCharge,
  TransportRecord,
} from '../modules/transport/domain/activity.entity.js';
import {
  Customer,
  CustomerProduct,
  Location,
  Product,
} from '../modules/transport/domain/catalogue.entity.js';
import { Dispatch } from '../modules/transport/domain/dispatch.entity.js';
import { TruckExpense } from '../modules/transport/domain/expense.entity.js';
import { TransportRate } from '../modules/transport/domain/rate.entity.js';
import { WhatsAppMessage } from '../modules/whatsapp/domain/whatsapp-message.entity.js';

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
  Customer,
  Location,
  Product,
  CustomerProduct,
  TransportRate,
  Dispatch,
  RecordingContext,
  TransportRecord,
  ActivityRevision,
  TransportCharge,
  TransportAttachment,
  TruckExpense,
  TransportAudit,
  User,
  WhatsAppMessage,
];
