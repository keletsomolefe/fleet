import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRequest } from '../auth/auth.service.js';
import { RbacService } from './rbac.service.js';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata('fleet.permissions', permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      'fleet.permissions',
      [context.getHandler(), context.getClass()],
    );
    const access = context
      .switchToHttp()
      .getRequest<AdminRequest>().adminContext;
    if (!required?.length || !access)
      throw new ForbiddenException('Access denied.');
    this.rbac.require(access, ...required);
    return true;
  }
}
