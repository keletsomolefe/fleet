import {
  HttpException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService, type AdminContext } from '../auth/auth.service.js';
import { KratosService, KratosError } from '../auth/kratos.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { DriverProfile } from '../fleet/fleet.entity.js';
import { parseLogin } from './mobile.input.js';
import { DrivingService } from './driving.service.js';

@Injectable()
export class MobileAuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(KratosService) private readonly kratos: KratosService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(DrivingService) private readonly driving: DrivingService,
  ) {}
  async login(raw: unknown, remote: string) {
    const input = parseLogin(raw);
    const now = Date.now(),
      key = `${remote}:${input.identifier.toLowerCase()}`;
    for (const [k, v] of this.attempts)
      if (v.until <= now) this.attempts.delete(k);
    const entry = this.attempts.get(key) ?? { count: 0, until: now + 60000 };
    if (++entry.count > 10)
      throw new HttpException('Too many attempts. Try again in a minute.', 429);
    if (this.attempts.size >= 5000)
      this.attempts.delete(this.attempts.keys().next().value!);
    this.attempts.set(key, entry);
    const profile = !input.identifier.includes('@')
      ? await this.db.getRepository(DriverProfile).findOne({
          where: { identifier: input.identifier.toUpperCase() },
          relations: { user: true },
        })
      : null;
    const identifier = (profile?.user.email ?? input.identifier).toLowerCase();
    let token: string;
    try {
      const flow = await this.kratos.request<{ id: string }>(
        'self-service/login/api',
      );
      const result = await this.kratos.request<{ session_token: string }>(
        `self-service/login?flow=${encodeURIComponent(flow.id)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            method: 'password',
            identifier,
            password: input.password,
          }),
        },
      );
      token = result.session_token;
      if (!token) throw new UnauthorizedException('Sign in unsuccessful.');
    } catch (error) {
      if (error instanceof KratosError)
        throw new UnauthorizedException(
          'Check your identifier and password, and verify your email.',
        );
      throw error;
    }
    try {
      const context = await this.auth.authenticateNative(token);
      const mode = await this.resolveMode(context);
      return {
        sessionToken: token,
        mode,
        permissions: context.permissions,
        user: this.auth.profile(context.user),
        expiresAt: context.session.expires_at ?? null,
      };
    } catch (error) {
      await this.kratos.revokeToken(token).catch(() => undefined);
      throw error;
    }
  }
  async resolveMode(context: AdminContext): Promise<'admin' | 'driver'> {
    // Mode is a navigation result, never an account type or a client-selected grant.
    if (context.permissions.includes('driver.access')) {
      const profile = await this.db
        .getRepository(DriverProfile)
        .findOneBy({ userId: context.user.id, status: 'active' });
      if (profile) return 'driver';
    }
    if (
      ['admin.access', 'trucks.read', 'trucks.write'].every((p) =>
        context.permissions.includes(p),
      )
    )
      return 'admin';
    this.rbac.require(context, 'driver.access');
    throw new ForbiddenException(
      'Driver access is not active. Contact your fleet administrator.',
    );
  }
  async logout(token: string) {
    try {
      await this.driving.endForLogout(
        await this.auth.authenticateNative(token),
      );
    } catch (error) {
      if (!(
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ))
        throw error;
    }
    try {
      await this.kratos.revokeToken(token);
    } catch (error) {
      if (!(error instanceof KratosError && [401, 403].includes(error.status)))
        throw error;
    }
  }
}
