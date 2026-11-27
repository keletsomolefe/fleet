import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { MikroORM } from '@mikro-orm/postgresql';
import { getEm, rawQuery } from '../../../database/context.js';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors.js';
import type {
  AdminContext,
  AuthService,
} from '../../identity/application/auth.service.js';
import {
  canManageVehicles,
  canReadIssues,
} from '../../identity/domain/permissions.js';

export class OperationsEventsService {
  readonly changes = new EventEmitter();
  private readonly tickets = new Map<
    string,
    { userId: string; expires: number; native?: string; cookie?: string }
  >();

  constructor(
    private readonly orm: MikroORM,
    private readonly auth: AuthService,
  ) {}

  require(context: AdminContext) {
    if (!canManageVehicles(context)) {
      throw new ForbiddenError('Vehicle management access is required.');
    }
  }

  private requireInbox(context: AdminContext) {
    if (!canManageVehicles(context) && !canReadIssues(context)) {
      throw new ForbiddenError('Issue access is required.');
    }
  }

  private requireUpdates(context: AdminContext, native?: string) {
    if (
      !native &&
      context.permissions.includes('admin.access') &&
      [
        'service_jobs.read',
        'service_providers.read',
        'activities.read',
        'dispatch.read',
        'revenue.read',
        'expenses.read',
        'shifts.read',
      ].some((permission) => context.permissions.includes(permission))
    ) {
      return;
    }
    this.requireInbox(context);
  }

  changed() {
    this.changes.emit('changed');
  }

  ticket(
    context: AdminContext,
    credentials: { native?: string; cookie?: string },
  ) {
    this.requireUpdates(context, credentials.native);
    for (const [key, value] of this.tickets) {
      if (value.expires < Date.now()) this.tickets.delete(key);
    }
    if (this.tickets.size >= 2000) {
      throw new ForbiddenError('Please try again shortly.');
    }
    const password = randomBytes(32).toString('base64url');
    this.tickets.set(password, {
      ...credentials,
      userId: context.user.id,
      expires: Date.now() + 120_000,
    });
    const url =
      process.env.MQTT_ENABLED === 'true'
        ? (process.env.MQTT_PUBLIC_URL ?? 'ws://127.0.0.1:1884/mqtt')
        : null;
    if (
      process.env.NODE_ENV === 'production' &&
      url &&
      !url.startsWith('wss://')
    ) {
      throw new ForbiddenError(
        'Secure notification transport is not configured.',
      );
    }
    return {
      mqttUrl: url,
      username: `admin:${context.user.id}`,
      password,
      topic: `fleet/admin/${context.user.id}/attention`,
      clientPrefix: `fleet-admin-${context.user.id}-`,
    };
  }

  async authenticate(ticket: string, username: string) {
    const value = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (
      !value ||
      value.expires < Date.now() ||
      username !== `admin:${value.userId}`
    ) {
      throw new UnauthorizedError();
    }
    const context = value.native
      ? await this.auth.authenticateNative(value.native)
      : await this.auth.authenticate(value.cookie);
    this.requireUpdates(context, value.native);
    if (context.user.id !== value.userId) throw new UnauthorizedError();
    return context.user.id;
  }

  async snapshot(context: AdminContext) {
    this.requireInbox(context);
    const em = getEm(this.orm);
    const [snapshot] = await rawQuery<{ count: number; latest: unknown[] }>(
      em,
      `WITH open_items AS (
        SELECT d.id, d.kind, NULL::text AS category, d."createdAt", t.registration,
          concat(u."firstName",' ',u."lastName") AS "driverName"
        FROM app.vehicle_disputes d
        JOIN app.trucks t ON t.id = d."truckId"
        JOIN app.driver_profiles p ON p.id = d."driverId"
        JOIN app.users u ON u.id = p."userId"
        WHERE d."resolvedAt" IS NULL AND $1::boolean
        UNION ALL
        SELECT i.id, 'issue', i.category, i."createdAt", t.registration,
          concat(u."firstName",' ',u."lastName") AS "driverName"
        FROM app.driver_issues i
        LEFT JOIN app.trucks t ON t.id = i."truckId"
        JOIN app.driver_profiles p ON p.id = i."driverId"
        JOIN app.users u ON u.id = p."userId"
        WHERE i."resolvedAt" IS NULL AND $2::boolean
      )
      SELECT count(*)::int AS count,
        COALESCE((
          SELECT jsonb_agg(item ORDER BY item."createdAt" DESC, item.id DESC)
          FROM (SELECT * FROM open_items ORDER BY "createdAt" DESC, id DESC LIMIT 20) item
        ), '[]'::jsonb) AS latest
      FROM open_items`,
      [canManageVehicles(context), canReadIssues(context)],
    );
    return snapshot;
  }
}
