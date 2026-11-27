import type { EntityManager } from '@mikro-orm/postgresql';
import { acquireAdvisoryLock } from '../../../database/context.js';
import { ForbiddenError } from '../../../shared/errors.js';
import { Permission, Role, RolePermission } from './rbac.entity.js';

const deferredPermissions = new Set([
  'exceptions.read',
  'exports.read',
  'vehicle_reports.read',
]);

export function isActivePermission(key: string): boolean {
  return !deferredPermissions.has(key);
}

type PermissionAccess = { permissions: readonly string[] };

export function canManageVehicles(access: PermissionAccess): boolean {
  return ['admin.access', 'trucks.read', 'trucks.write'].every((key) =>
    access.permissions.includes(key),
  );
}

export function canReadIssues(access: PermissionAccess): boolean {
  return ['admin.access', 'issues.read'].every((key) =>
    access.permissions.includes(key),
  );
}

export function requireIssues(access: PermissionAccess, resolve = false): void {
  if (
    !canReadIssues(access) ||
    (resolve && !access.permissions.includes('issues.resolve'))
  ) {
    throw new ForbiddenError('You do not have access to these issues.');
  }
}

/**
 * Canonical permission catalogue. `fleet_map.read`, `overview.read` and the other
 * navigation permissions drive the web dashboard; the service-job and issue
 * permissions are enforced by the API.
 */
export const permissionCatalogue = [
  { key: 'activities.read', name: 'Activities' },
  { key: 'activities.review', name: 'Review activities' },
  { key: 'activities.write', name: 'Record activities' },
  { key: 'admin.access', name: 'Admin access' },
  { key: 'customers.read', name: 'Customers' },
  { key: 'customers.write', name: 'Manage customers' },
  { key: 'dispatch.read', name: 'Dispatch' },
  { key: 'dispatch.write', name: 'Manage dispatch' },
  { key: 'driver.access', name: 'Driver app' },
  { key: 'drivers.read', name: 'Drivers' },
  { key: 'drivers.write', name: 'Manage drivers' },
  { key: 'exceptions.read', name: 'Exceptions' },
  { key: 'expenses.read', name: 'View expenses' },
  { key: 'expenses.write', name: 'Manage expenses' },
  { key: 'exports.read', name: 'Exports' },
  { key: 'fleet_map.read', name: 'Fleet map' },
  { key: 'issues.read', name: 'View reported issues' },
  { key: 'issues.resolve', name: 'Resolve reported issues' },
  { key: 'locations.read', name: 'Locations' },
  { key: 'locations.write', name: 'Manage locations' },
  { key: 'overview.read', name: 'Overview' },
  { key: 'pricing.read', name: 'View rates' },
  { key: 'pricing.write', name: 'Manage rates' },
  { key: 'products.read', name: 'Products' },
  { key: 'products.write', name: 'Manage products' },
  { key: 'revenue.read', name: 'Truck earnings' },
  { key: 'service_jobs.read', name: 'View service jobs' },
  { key: 'service_jobs.write', name: 'Manage service jobs' },
  { key: 'service_providers.read', name: 'View service providers' },
  { key: 'service_providers.write', name: 'Manage service providers' },
  { key: 'shifts.read', name: 'Shifts & mileage' },
  { key: 'trucks.read', name: 'Vehicles' },
  { key: 'trucks.write', name: 'Manage vehicles' },
  { key: 'users.access', name: 'Manage user access' },
  { key: 'users.create', name: 'Create users' },
  { key: 'users.owners', name: 'Manage owners' },
  { key: 'users.read', name: 'Users and roles' },
  { key: 'vehicle_reports.read', name: 'Vehicle reports' },
] as const;

export const roleCatalogue = [
  { key: 'owner', name: 'Owner' },
  { key: 'administrator', name: 'Administrator' },
  { key: 'driver', name: 'Driver' },
  { key: 'truck_mechanic', name: 'Truck mechanic' },
] as const;

const ownerPermissions = permissionCatalogue.map((permission) => permission.key);
const administratorPermissions = ownerPermissions.filter(
  (key) => key !== 'driver.access' && key !== 'users.owners',
);
const driverPermissions = ['driver.access'] as const;
const mechanicPermissions = [
  'admin.access',
  'issues.read',
  'issues.resolve',
] as const;

/**
 * Ensures the permission/role catalogue is present and up to date.
 * Must be run inside an active MikroORM transaction.
 */
export async function configureRoles(em: EntityManager): Promise<void> {
  await acquireAdvisoryLock(em, 'fleet-user-access-v1');
  await em.upsertMany(
    Permission,
    permissionCatalogue.map((entry) => ({ ...entry })),
    { onConflictFields: ['key'] },
  );
  await em.upsertMany(
    Role,
    roleCatalogue.map((entry) => ({ ...entry })),
    { onConflictFields: ['key'] },
  );

  const permissions = await em.find(Permission, {});
  const byKey = new Map(
    permissions.map((permission) => [permission.key, permission]),
  );

  const grantsFor = (keys: readonly string[]) =>
    keys
      .map((key) => byKey.get(key))
      .filter((permission): permission is Permission => Boolean(permission));

  const mechanic = await em.findOneOrFail(Role, { key: 'truck_mechanic' });
  const mechanicGrants = grantsFor(mechanicPermissions);
  if (mechanicGrants.length !== mechanicPermissions.length) {
    throw new Error('The existing role catalogue is incomplete.');
  }
  await em.nativeDelete(RolePermission, { role: mechanic.id });
  await em.insertMany(
    RolePermission,
    mechanicGrants.map((permission) => ({
      role: mechanic.id,
      permission: permission.id,
    })),
  );

  const addGrants = async (roleKey: string, keys: readonly string[]) => {
    const role = await em.findOneOrFail(Role, { key: roleKey });
    await em.upsertMany(
      RolePermission,
      grantsFor(keys).map((permission) => ({
        role: role.id,
        permission: permission.id,
      })),
      { onConflictFields: ['role', 'permission'] },
    );
  };
  await addGrants('owner', ownerPermissions);
  await addGrants('administrator', administratorPermissions);
  await addGrants('driver', driverPermissions);

  // Retiring roles also revokes their assignments and grants via CASCADE.
  await em.nativeDelete(Role, {
    key: { $in: ['dispatcher', 'terminal_operator'] },
  });
  await em.nativeDelete(Permission, { key: 'terminal.access' });
}
