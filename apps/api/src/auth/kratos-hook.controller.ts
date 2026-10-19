import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity.js';
import { secretEqual } from './auth.service.js';

@Controller('internal/kratos')
export class KratosHookController {
  private readonly logger = new Logger(KratosHookController.name);
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Post('after-login')
  @HttpCode(204)
  async afterLogin(
    @Headers('x-kratos-hook-secret') secret: string | undefined,
    @Body() raw: unknown,
  ) {
    if (
      !process.env.KRATOS_HOOK_SECRET ||
      !secretEqual(secret ?? '', process.env.KRATOS_HOOK_SECRET)
    )
      throw new UnauthorizedException();
    const body = raw as {
      identity?: {
        id?: string;
        traits?: { email?: string; name?: { first?: string; last?: string } };
      };
      authenticated_at?: string;
    } | null;
    const identity = body?.identity;
    const at = new Date(body?.authenticated_at ?? '');
    const traits = identity?.traits;
    if (
      !identity?.id ||
      !/^[0-9a-f-]{36}$/i.test(identity.id) ||
      !Number.isFinite(at.getTime()) ||
      typeof traits?.email !== 'string' ||
      typeof traits.name?.first !== 'string' ||
      typeof traits.name.last !== 'string' ||
      traits.email.length > 320 ||
      traits.name.first.length > 100 ||
      traits.name.last.length > 100
    )
      throw new BadRequestException('Invalid identity event.');
    try {
      // This event can arrive repeatedly or out of order. Never change access or create a user.
      await this.users
        .createQueryBuilder()
        .update(User)
        .set({
          email: traits.email.trim().toLowerCase(),
          firstName: traits.name.first,
          lastName: traits.name.last,
          lastLoginAt: at,
        })
        .where('"kratosIdentityId" = :id', { id: identity.id })
        .andWhere('("lastLoginAt" IS NULL OR "lastLoginAt" < :at)', { at })
        .execute();
    } catch {
      this.logger.warn(
        'Login profile synchronization failed; authorization remains enforced on each request.',
      );
    }
  }
}
