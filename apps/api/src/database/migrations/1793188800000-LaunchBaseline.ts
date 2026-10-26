import type { MigrationInterface, QueryRunner } from 'typeorm';
import { baselineSchema } from '../baseline-schema.js';
import { transportSchema } from '../../transport/schema.js';

const permissions = [
  ['admin.access', 'Admin access'],
  ['overview.read', 'Overview'],
  ['dispatch.read', 'Dispatch'],
  ['dispatch.write', 'Manage dispatch'],
  ['fleet_map.read', 'Fleet map'],
  ['drivers.read', 'Drivers'],
  ['drivers.write', 'Manage drivers'],
  ['trucks.read', 'Vehicles'],
  ['trucks.write', 'Manage vehicles'],
  ['customers.read', 'Customers'],
  ['customers.write', 'Manage customers'],
  ['locations.read', 'Locations'],
  ['locations.write', 'Manage locations'],
  ['products.read', 'Products'],
  ['products.write', 'Manage products'],
  ['activities.read', 'Activities'],
  ['activities.write', 'Record activities'],
  ['activities.review', 'Review activities'],
  ['pricing.read', 'View rates'],
  ['pricing.write', 'Manage rates'],
  ['revenue.read', 'Truck earnings'],
  ['exceptions.read', 'Exceptions'],
  ['exports.read', 'Exports'],
  ['vehicle_reports.read', 'Vehicle reports'],
  ['shifts.read', 'Shifts & mileage'],
  ['users.read', 'Users and roles'],
  ['users.create', 'Create users'],
  ['users.access', 'Manage user access'],
  ['users.owners', 'Manage owners'],
  ['driver.access', 'Driver app'],
  ['terminal.access', 'Terminal'],
];
export class LaunchBaseline1793188800000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(baselineSchema);
    await q.query(transportSchema);
    for (const [key, name] of permissions)
      await q.query('INSERT INTO app.permissions(key,name) VALUES($1,$2)', [
        key,
        name,
      ]);
    const dispatcher = [
      'admin.access',
      'overview.read',
      'dispatch.read',
      'dispatch.write',
      'fleet_map.read',
      'drivers.read',
      'trucks.read',
      'customers.read',
      'customers.write',
      'locations.read',
      'locations.write',
      'products.read',
      'activities.read',
      'exceptions.read',
      'shifts.read',
    ];
    for (const [key, name, grants] of [
      ['owner', 'Owner', permissions.map((p) => p[0])],
      [
        'administrator',
        'Administrator',
        permissions
          .map((p) => p[0])
          .filter(
            (p) =>
              !['users.owners', 'driver.access', 'terminal.access'].includes(
                p!,
              ),
          ),
      ],
      ['dispatcher', 'Dispatcher', dispatcher],
      ['driver', 'Driver', ['driver.access']],
      ['terminal_operator', 'Terminal operator', ['terminal.access']],
    ] as Array<[string, string, string[]]>) {
      const [role] = await q.query(
        'INSERT INTO app.roles(key,name) VALUES($1,$2) RETURNING id',
        [key, name],
      );
      await q.query(
        'INSERT INTO app.role_permissions("roleId","permissionId") SELECT $1,id FROM app.permissions WHERE key=ANY($2::text[])',
        [role.id, grants],
      );
    }
  }
  async down(q: QueryRunner) {
    const tables = await q.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='app' AND tablename<>'migrations'`,
    );
    for (const { tablename } of tables)
      await q.query(
        `DROP TABLE IF EXISTS app."${String(tablename).replaceAll('"', '""')}" CASCADE`,
      );
  }
}
