import { ForbiddenException } from '@nestjs/common';

type Access = { permissions: string[] };

export function canManageVehicles(access: Access): boolean {
  return ['admin.access', 'trucks.read', 'trucks.write'].every((key) =>
    access.permissions.includes(key),
  );
}

export function canReadIssues(access: Access): boolean {
  return ['admin.access', 'issues.read'].every((key) =>
    access.permissions.includes(key),
  );
}

export function requireIssues(access: Access, resolve = false): void {
  if (
    !canReadIssues(access) ||
    (resolve && !access.permissions.includes('issues.resolve'))
  )
    throw new ForbiddenException('You do not have access to these issues.');
}
