import type { EntityManager } from '../database/database.js';
import { Permission, Role, RolePermission } from './rbac.entity.js';

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
];

export const roleCatalogue = [
  { key: 'owner', name: 'Owner' },
  { key: 'administrator', name: 'Administrator' },
  { key: 'driver', name: 'Driver' },
  { key: 'truck_mechanic', name: 'Truck mechanic' },
];

// Grants managed by this catalogue. Owner and administrator grants are only
// added (never revoked) so manual grants made later are preserved; the truck
// mechanic grants are replaced to match this list exactly.
const ownerPermissions = permissionCatalogue.map((permission) => permission.key);
const administratorPermissions = ownerPermissions.filter(
  (key) => key !== 'driver.access' && key !== 'users.owners',
);
const driverPermissions = ['driver.access'];
const mechanicPermissions = ['admin.access', 'issues.read', 'issues.resolve'];

/**
 * Ensures the permission/role catalogue is present and up to date.
 *
 * Shared by the `RoleSeeder` (fresh database initialization) and the
 * `configure:roles` maintenance script (existing deployments). The caller is
 * responsible for running it inside a transaction; it takes the same advisory
 * lock as user access edits so role configuration cannot interleave with them.
 */
export async function configureRoles(em: EntityManager): Promise<void> {
  await em.query(
    "SELECT pg_advisory_xact_lock(hashtext('fleet-user-access-v1'))",
  );
  await em.upsert(Permission, permissionCatalogue, { onConflictFields: ['key'] });
  await em.upsert(Role, roleCatalogue, { onConflictFields: ['key'] });
  const permissions = await em.find(Permission);
  const byKey = new Map(permissions.map((permission) => [permission.key, permission]));

  const grantsFor = (keys: readonly string[]) =>
    keys
      .map((key) => byKey.get(key))
      .filter((permission): permission is Permission => !!permission);

  const mechanic = await em.findOneOrFail(Role, { key: 'truck_mechanic' });
  const mechanicKeys = grantsFor(mechanicPermissions);
  if (mechanicKeys.length !== mechanicPermissions.length)
    throw new Error('The existing role catalogue is incomplete.');
  await em.delete(RolePermission, { role: mechanic.id });
  await em.insert(
    RolePermission,
    mechanicKeys.map((permission) => ({
      role: mechanic.id,
      permission: permission.id,
    })),
  );

  // Add missing catalogued grants; existing extra grants are left alone.
  const addGrants = async (roleKey: string, keys: readonly string[]) => {
    const role = await em.findOneOrFail(Role, { key: roleKey });
    await em.upsert(
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

  // Retiring roles also revokes their assignments and grants.
  await em.delete(Role, {
    key: { $in: ['dispatcher', 'terminal_operator'] },
  });
  await em.delete(Permission, { key: 'terminal.access' });
}
