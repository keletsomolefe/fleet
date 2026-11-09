const deferredPermissions = new Set([
  'customers.read',
  'customers.write',
  'locations.read',
  'locations.write',
  'products.read',
  'products.write',
  'pricing.read',
  'pricing.write',
  'dispatch.read',
  'dispatch.write',
  'activities.read',
  'activities.write',
  'activities.review',
  'revenue.read',
  'exceptions.read',
  'exports.read',
  'vehicle_reports.read',
  'shifts.read',
]);

export function isActivePermission(key: string): boolean {
  return !deferredPermissions.has(key);
}
