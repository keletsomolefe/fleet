import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService, type AdminContext } from '../auth/auth.service.js';

@Injectable()
export class OperationsEventsService {
  readonly changes = new EventEmitter();
  private readonly tickets = new Map<
    string,
    { userId: string; expires: number; native?: string; cookie?: string }
  >();
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  require(c: AdminContext) {
    if (
      !['admin.access', 'trucks.read', 'trucks.write'].every((p) =>
        c.permissions.includes(p),
      )
    )
      throw new ForbiddenException('Vehicle management access is required.');
  }
  changed() {
    this.changes.emit('changed');
  }
  ticket(c: AdminContext, credentials: { native?: string; cookie?: string }) {
    this.require(c);
    for (const [key, value] of this.tickets)
      if (value.expires < Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 2000)
      throw new ForbiddenException('Please try again shortly.');
    const password = randomBytes(32).toString('base64url');
    this.tickets.set(password, {
      ...credentials,
      userId: c.user.id,
      expires: Date.now() + 120000,
    });
    const url =
      process.env.MQTT_ENABLED === 'true'
        ? (process.env.MQTT_PUBLIC_URL ?? 'ws://127.0.0.1:1884/mqtt')
        : null;
    if (
      process.env.NODE_ENV === 'production' &&
      url &&
      !url.startsWith('wss://')
    )
      throw new ForbiddenException(
        'Secure notification transport is not configured.',
      );
    return {
      mqttUrl: url,
      username: `admin:${c.user.id}`,
      password,
      topic: `fleet/admin/${c.user.id}/attention`,
      clientPrefix: `fleet-admin-${c.user.id}-`,
    };
  }
  async authenticate(ticket: string, username: string) {
    const value = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (
      !value ||
      value.expires < Date.now() ||
      username !== `admin:${value.userId}`
    )
      throw new UnauthorizedException();
    const c = value.native
      ? await this.auth.authenticateNative(value.native)
      : await this.auth.authenticate(value.cookie);
    this.require(c);
    if (c.user.id !== value.userId) throw new UnauthorizedException();
    return c.user.id;
  }
  async snapshot(c: AdminContext) {
    this.require(c);
    const [count] = await this.db.query(
      'SELECT count(*)::int AS count FROM app.vehicle_disputes WHERE "resolvedAt" IS NULL',
    );
    const latest = await this.db
      .query(`SELECT d.id, d.kind, d."createdAt", t.registration, concat(u."firstName",' ',u."lastName") AS "driverName"
      FROM app.vehicle_disputes d JOIN app.trucks t ON t.id=d."truckId" JOIN app.driver_profiles p ON p.id=d."driverId" JOIN app.users u ON u.id=p."userId"
      WHERE d."resolvedAt" IS NULL ORDER BY d."createdAt" DESC,d.id DESC LIMIT 20`);
    return { count: count.count as number, latest };
  }
}
