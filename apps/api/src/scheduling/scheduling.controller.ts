import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type AdminRequest } from '../auth/auth.service.js';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../rbac/permissions.guard.js';
import { bearer } from '../mobile/mobile.input.js';
import { SchedulingService } from './scheduling.service.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';

@Controller('admin/schedules')
@UseGuards(PermissionsGuard)
export class AdminSchedulesController {
  constructor(
    @Inject(SchedulingService) private readonly schedules: SchedulingService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get()
  @RequirePermissions(
    'admin.access',
    'drivers.read',
    'drivers.write',
    'trucks.read',
    'trucks.write',
  )
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() r: AdminRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.schedules.list(r.adminContext!, from, to);
  }
  @Post()
  @HttpCode(200)
  @RequirePermissions(
    'admin.access',
    'drivers.read',
    'drivers.write',
    'trucks.read',
    'trucks.write',
  )
  save(@Req() r: AdminRequest, @Body() body: unknown) {
    this.auth.verifyCsrf(r);
    return this.schedules.save(r.adminContext!, body);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(
    'admin.access',
    'drivers.read',
    'drivers.write',
    'trucks.read',
    'trucks.write',
  )
  cancel(
    @Req() r: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(r);
    return this.schedules.cancel(r.adminContext!, id, body);
  }
}
@Controller('admin/notifications')
@UseGuards(PermissionsGuard)
export class AdminNotificationsController {
  constructor(
    @Inject(OperationsEventsService)
    private readonly events: OperationsEventsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get()
  @RequirePermissions('admin.access', 'trucks.read', 'trucks.write')
  @Header('Cache-Control', 'private, no-store')
  list(@Req() r: AdminRequest) {
    return this.events.snapshot(r.adminContext!);
  }
  @Post('connection')
  @HttpCode(200)
  @RequirePermissions('admin.access', 'trucks.read', 'trucks.write')
  @Header('Cache-Control', 'private, no-store')
  connection(@Req() r: AdminRequest) {
    this.auth.verifyCsrf(r);
    return this.events.ticket(r.adminContext!, { cookie: r.headers.cookie });
  }
}
@Controller('mobile')
export class MobileSchedulesController {
  constructor(
    @Inject(SchedulingService) private readonly schedules: SchedulingService,
    @Inject(OperationsEventsService)
    private readonly events: OperationsEventsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Post('driver/schedule-mismatch')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async mismatch(@Req() r: Request, @Body() body: unknown) {
    return this.schedules.mismatch(
      await this.auth.authenticateNative(bearer(r)),
      body,
    );
  }
  @Get('admin/schedules')
  @Header('Cache-Control', 'private, no-store')
  async list(
    @Req() r: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.schedules.list(
      await this.auth.authenticateNative(bearer(r)),
      from,
      to,
    );
  }
  @Get('admin/schedules/options')
  @Header('Cache-Control', 'private, no-store')
  async options(@Req() r: Request, @Query('q') q?: string) {
    return this.schedules.options(
      await this.auth.authenticateNative(bearer(r)),
      q,
    );
  }
  @Post('admin/schedules/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.schedules.cancel(
      await this.auth.authenticateNative(bearer(r)),
      id,
      body,
    );
  }
  @Post('admin/schedules')
  @HttpCode(200)
  async save(@Req() r: Request, @Body() body: unknown) {
    return this.schedules.save(
      await this.auth.authenticateNative(bearer(r)),
      body,
    );
  }
  @Get('admin/notifications')
  @Header('Cache-Control', 'private, no-store')
  async notifications(@Req() r: Request) {
    return this.events.snapshot(await this.auth.authenticateNative(bearer(r)));
  }
  @Post('admin/notifications/connection')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async connection(@Req() r: Request) {
    const native = bearer(r);
    return this.events.ticket(await this.auth.authenticateNative(native), {
      native,
    });
  }
}
