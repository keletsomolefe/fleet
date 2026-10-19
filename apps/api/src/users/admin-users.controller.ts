import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService, type AdminRequest } from '../auth/auth.service.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../rbac/permissions.guard.js';

@Controller('admin/users')
@UseGuards(PermissionsGuard)
export class AdminUsersController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AdminUsersService) private readonly users: AdminUsersService,
  ) {}
  @Post()
  @RequirePermissions('users.create')
  async create(@Body() input: unknown, @Req() request: AdminRequest) {
    this.auth.verifyCsrf(request);
    const user = await this.users.create(input, request.adminContext!.user);
    return { user: this.auth.profile(user), requiresEmailVerification: true };
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('users.read')
  list(@Query('q') query?: string, @Query('page') page?: string) {
    return this.users.list(query, page);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('users.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id/access')
  @RequirePermissions('users.access')
  async access(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() request: AdminRequest,
  ) {
    this.auth.verifyCsrf(request);
    return this.users.setAccess(request.adminContext!.user.id, id, input);
  }
}
