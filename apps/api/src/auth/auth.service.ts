import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { User } from '../users/user.entity.js';
import { RbacService, type Access } from '../rbac/rbac.service.js';
import {
  KratosError,
  KratosService,
  type KratosSession,
} from './kratos.service.js';

export interface AdminContext extends Access {
  user: User;
  session: KratosSession;
}
export type AdminRequest = Request & { adminContext?: AdminContext };

export function secretEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(KratosService) private readonly kratos: KratosService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async authenticate(cookie?: string): Promise<AdminContext> {
    if (!cookie) throw new UnauthorizedException('Please sign in.');
    let session: KratosSession;
    try {
      session = await this.kratos.whoami(cookie);
    } catch (error) {
      if (error instanceof KratosError && [401, 403].includes(error.status))
        throw new UnauthorizedException(
          'Your session has ended. Please sign in.',
        );
      throw error;
    }
    return this.authorize(session, ['admin.access']);
  }

  async authenticateNative(token: string): Promise<AdminContext> {
    let session: KratosSession;
    try {
      session = await this.kratos.whoamiToken(token);
    } catch (error) {
      if (error instanceof KratosError && [401, 403].includes(error.status))
        throw new UnauthorizedException(
          'Your session has ended. Please sign in.',
        );
      throw error;
    }
    return this.authorize(session, []);
  }

  private async authorize(
    session: KratosSession,
    required: string[],
  ): Promise<AdminContext> {
    if (!session.active || session.identity.state === 'inactive')
      throw new UnauthorizedException('Please sign in.');
    const email = session.identity.traits.email.toLowerCase();
    if (
      !session.identity.verifiable_addresses?.some(
        (a) =>
          a.verified && a.via === 'email' && a.value.toLowerCase() === email,
      )
    ) {
      throw new ForbiddenException('Verify your email before continuing.');
    }
    let user: User | null;
    try {
      user = await this.users.findOneBy({
        kratosIdentityId: session.identity.id,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Account access is temporarily unavailable.',
      );
    }
    if (!user || !user.isActive)
      throw new ForbiddenException('This account is not active.');
    let access: Access;
    try {
      access = await this.rbac.access(user.id);
    } catch {
      throw new ServiceUnavailableException(
        'Account access is temporarily unavailable.',
      );
    }
    this.rbac.require(access, ...required);
    return { user, session, ...access };
  }

  csrfToken(context: AdminContext): string {
    const secret = process.env.APP_CSRF_SECRET;
    if (!secret)
      throw new ServiceUnavailableException(
        'Request protection is not configured.',
      );
    return createHmac('sha256', secret)
      .update(`${context.user.id}:${context.session.id}`)
      .digest('hex');
  }

  verifyCsrf(request: AdminRequest): void {
    const origin = request.get('origin');
    const appUrl = process.env.APP_URL && new URL(process.env.APP_URL);
    const allowedOrigins = new Set(appUrl ? [appUrl.origin] : []);
    if (
      appUrl &&
      process.env.NODE_ENV !== 'production' &&
      ['localhost', '127.0.0.1'].includes(appUrl.hostname)
    ) {
      const alias = new URL(appUrl);
      alias.hostname =
        appUrl.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      allowedOrigins.add(alias.origin);
    }
    if (
      !origin ||
      !allowedOrigins.has(origin) ||
      !request.adminContext ||
      !secretEqual(
        request.get('x-csrf-token') ?? '',
        this.csrfToken(request.adminContext),
      )
    ) {
      throw new ForbiddenException(
        'Invalid request. Refresh the page and try again.',
      );
    }
  }

  profile(user: User) {
    return {
      id: user.id,
      identityId: user.kratosIdentityId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
