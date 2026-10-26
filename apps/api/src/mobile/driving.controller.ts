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
import { bearer } from './mobile.input.js';
import { DrivingService } from './driving.service.js';

@Controller('mobile')
export class DrivingController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DrivingService) private readonly driving: DrivingService,
  ) {}
  @Get('driver/context')
  @Header('Cache-Control', 'private, no-store')
  async context(@Req() req: Request) {
    return this.driving.context(
      await this.auth.authenticateNative(bearer(req)),
    );
  }
  @Get('driver/vehicles')
  @Header('Cache-Control', 'private, no-store')
  async vehicles(
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('page') page?: string,
  ) {
    return this.driving.vehicles(
      await this.auth.authenticateNative(bearer(req)),
      q,
      page,
    );
  }
  @Post('driver/driving-sessions')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async start(@Req() req: Request, @Body() body: unknown) {
    return this.driving.start(
      await this.auth.authenticateNative(bearer(req)),
      body,
    );
  }
  @Post('driver/driving-sessions/end')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async end(@Req() req: Request, @Body() body: unknown) {
    return this.driving.end(
      await this.auth.authenticateNative(bearer(req)),
      body,
    );
  }
  @Post('driver/vehicles/:id/flag')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async flag(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.driving.flag(
      await this.auth.authenticateNative(bearer(req)),
      id,
      body,
    );
  }
  @Get('driver/vehicle-disputes')
  @Header('Cache-Control', 'private, no-store')
  async ownDisputes(@Req() req: Request) {
    return this.driving.disputes(
      await this.auth.authenticateNative(bearer(req)),
      true,
    );
  }
  @Get('admin/vehicle-disputes')
  @Header('Cache-Control', 'private, no-store')
  async disputes(@Req() req: Request) {
    return this.driving.disputes(
      await this.auth.authenticateNative(bearer(req)),
    );
  }
  @Post('admin/vehicle-disputes/:id/resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async resolve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.driving.resolve(
      await this.auth.authenticateNative(bearer(req)),
      id,
      body,
    );
  }
}

@Controller('admin/vehicle-disputes')
@UseGuards(PermissionsGuard)
export class AdminVehicleDisputesController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DrivingService) private readonly driving: DrivingService,
  ) {}
  @Get()
  @RequirePermissions('admin.access', 'trucks.read', 'trucks.write')
  @Header('Cache-Control', 'private, no-store')
  list(@Req() req: AdminRequest) {
    return this.driving.disputes(req.adminContext!);
  }
  @Post(':id/resolve')
  @RequirePermissions('admin.access', 'trucks.read', 'trucks.write')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  resolve(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(req);
    return this.driving.resolve(req.adminContext!, id, body);
  }
}
