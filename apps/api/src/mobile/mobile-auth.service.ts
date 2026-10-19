import {
  HttpException,
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

@Injectable()
export class MobileAuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(KratosService) private readonly kratos: KratosService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RbacService) private readonly rbac: RbacService,
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
    const profile =
      input.mode === 'driver'
        ? await this.db.getRepository(DriverProfile).findOne({
            where: { identifier: input.identifier.toUpperCase() },
            relations: { user: true },
          })
        : null;
    const identifier =
      input.mode === 'driver'
        ? (profile?.user.email ?? input.identifier)
        : input.identifier.toLowerCase();
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
      if (input.mode === 'setup') this.requireSetup(context);
      else {
        this.rbac.require(context, 'driver.access');
        if (
          !profile ||
          profile.userId !== context.user.id ||
          profile.status !== 'active'
        )
          throw new UnauthorizedException(
            'Driver access is not active. Contact your fleet administrator.',
          );
      }
      return {
        sessionToken: token,
        mode: input.mode,
        user: this.auth.profile(context.user),
        expiresAt: context.session.expires_at ?? null,
      };
    } catch (error) {
      await this.kratos.revokeToken(token).catch(() => undefined);
      throw error;
    }
  }
  requireSetup(context: AdminContext) {
    this.rbac.require(context, 'admin.access', 'trucks.read', 'trucks.write');
  }
  async logout(token: string) {
    try {
      await this.kratos.revokeToken(token);
    } catch (error) {
      if (!(error instanceof KratosError && [401, 403].includes(error.status)))
        throw error;
    }
  }
}
