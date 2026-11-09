import type { DataSource } from 'typeorm';
import { Permission, Role, RolePermission } from './rbac.entity.js';

// Update role data in the existing app schema; no schema creation or migrations.
export async function configureRoles(db: DataSource): Promise<void> {
  await db.transaction(async (manager) => {
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtext('fleet-user-access-v1'))",
    );
    await manager.upsert(
      Permission,
      [
        { key: 'issues.read', name: 'View reported issues' },
        { key: 'issues.resolve', name: 'Resolve reported issues' },
      ],
      ['key'],
    );
    await manager.upsert(
      Role,
      { key: 'truck_mechanic', name: 'Truck mechanic' },
      ['key'],
    );
    const mechanic = await manager.findOneByOrFail(Role, {
      key: 'truck_mechanic',
    });
    const permissions = await manager.find(Permission);
    const mechanicKeys = ['admin.access', 'issues.read', 'issues.resolve'];
    if (!mechanicKeys.every((key) => permissions.some((p) => p.key === key)))
      throw new Error('The existing role catalogue is incomplete.');
    await manager.delete(RolePermission, { roleId: mechanic.id });
    await manager.insert(
      RolePermission,
      permissions
        .filter((p) => mechanicKeys.includes(p.key))
        .map((p) => ({ roleId: mechanic.id, permissionId: p.id })),
    );
    for (const key of ['owner', 'administrator']) {
      const role = await manager.findOneByOrFail(Role, { key });
      await manager.upsert(
        RolePermission,
        permissions
          .filter((p) => ['issues.read', 'issues.resolve'].includes(p.key))
          .map((p) => ({ roleId: role.id, permissionId: p.id })),
        ['roleId', 'permissionId'],
      );
    }
  });
}
