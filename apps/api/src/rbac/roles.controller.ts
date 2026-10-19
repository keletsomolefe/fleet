import { Controller, Get, Inject, UseGuards, Header } from '@nestjs/common';
import { PermissionsGuard, RequirePermissions } from './permissions.guard.js';
import { RbacService } from './rbac.service.js';

@Controller('admin/roles')
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(@Inject(RbacService) private readonly rbac: RbacService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('users.read')
  list() {
    return this.rbac.catalog();
  }
}
