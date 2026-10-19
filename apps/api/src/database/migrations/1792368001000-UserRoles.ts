import type { MigrationInterface, QueryRunner } from 'typeorm';

// This catalog is an immutable migration snapshot. Extend it through new migrations.
const permissions = [
  ['workspace.access', 'Admin workspace'],
  ['overview.read', 'Overview'],
  ['dispatch.read', 'Dispatch'],
  ['fleet_map.read', 'Fleet map'],
  ['drivers.read', 'Drivers'],
  ['trucks.read', 'Trucks & devices'],
  ['customers.read', 'Customers'],
  ['locations.read', 'Locations'],
  ['activities.read', 'Activities & proof'],
  ['exceptions.read', 'Exceptions'],
  ['exports.read', 'Exports'],
  ['vehicle_reports.read', 'Vehicle reports'],
  ['shifts.read', 'Shifts & mileage'],
  ['users.read', 'View users and roles'],
  ['users.create', 'Create users'],
  ['users.access', 'Manage user access'],
  ['users.owners', 'Manage owners'],
  ['driver.access', 'Driver app'],
  ['terminal.access', 'Terminal'],
];

export class UserRoles1792368001000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE app.permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key varchar(100) NOT NULL UNIQUE, name varchar(100) NOT NULL
    )`);
    await q.query(`CREATE TABLE app.roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key varchar(64) NOT NULL UNIQUE, name varchar(100) NOT NULL
    )`);
    await q.query(`CREATE TABLE app.role_permissions (
      "roleId" uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
      "permissionId" uuid NOT NULL REFERENCES app.permissions(id) ON DELETE CASCADE,
      PRIMARY KEY ("roleId", "permissionId")
    )`);
    await q.query(`CREATE TABLE app.user_roles (
      "userId" uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      "roleId" uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
      "createdAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("userId", "roleId")
    )`);
    await q.query(
      'CREATE INDEX idx_user_roles_role ON app.user_roles ("roleId")',
    );
    for (const [key, name] of permissions)
      await q.query('INSERT INTO app.permissions (key, name) VALUES ($1, $2)', [
        key,
        name,
      ]);
    const bundles: Array<[string, string, string[]]> = [
      ['owner', 'Owner', permissions.map(([key]) => key!)],
      [
        'administrator',
        'Administrator',
        permissions
          .map(([key]) => key!)
          .filter(
            (key) =>
              !['users.owners', 'driver.access', 'terminal.access'].includes(
                key,
              ),
          ),
      ],
      [
        'dispatcher',
        'Dispatcher',
        [
          'workspace.access',
          'overview.read',
          'dispatch.read',
          'fleet_map.read',
          'drivers.read',
          'trucks.read',
          'customers.read',
          'locations.read',
          'activities.read',
          'exceptions.read',
          'shifts.read',
        ],
      ],
      ['driver', 'Driver', ['driver.access']],
      ['terminal_operator', 'Terminal operator', ['terminal.access']],
    ];
    for (const [key, name, grants] of bundles) {
      const [role] = await q.query(
        'INSERT INTO app.roles (key, name) VALUES ($1, $2) RETURNING id',
        [key, name],
      );
      await q.query(
        'INSERT INTO app.role_permissions ("roleId", "permissionId") SELECT $1, id FROM app.permissions WHERE key = ANY($2::text[])',
        [role.id, grants],
      );
    }
    await q.query(`INSERT INTO app.user_roles ("userId", "roleId")
      SELECT u.id, r.id FROM app.users u JOIN app.roles r ON r.key = CASE WHEN u."userType"='admin' THEN 'administrator' ELSE 'driver' END`);
    // Preserve legacy access and nominate the earliest active administrator as owner.
    await q.query(`INSERT INTO app.user_roles ("userId", "roleId")
      SELECT u.id, r.id FROM app.users u CROSS JOIN app.roles r
      WHERE u."userType"='admin' AND u."isActive"=true AND r.key='owner'
      ORDER BY u."createdAt", u.id LIMIT 1`);
    await q.query('ALTER TABLE app.users DROP COLUMN "userType"');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE app.users ADD COLUMN "userType" varchar(20) NOT NULL DEFAULT 'driver' CHECK ("userType" IN ('admin', 'driver'))`,
    );
    await q.query(`UPDATE app.users u SET "userType"='admin' WHERE EXISTS (
      SELECT 1 FROM app.user_roles ur JOIN app.role_permissions rp ON rp."roleId"=ur."roleId"
      JOIN app.permissions p ON p.id=rp."permissionId"
      WHERE ur."userId"=u.id AND p.key='workspace.access')`);
    await q.query(
      'DROP TABLE app.user_roles, app.role_permissions, app.roles, app.permissions',
    );
  }
}
