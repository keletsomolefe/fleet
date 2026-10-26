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
import { AuthService } from '../auth/auth.service.js';
import { bearer, nativeRequest } from '../mobile/mobile.input.js';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../rbac/permissions.guard.js';
import { TelemetryService } from './telemetry.service.js';
@Controller('mobile/telemetry')
export class MobileTelemetryController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
  ) {}
  @Get('config')
  @Header('Cache-Control', 'private, no-store')
  config(@Req() req: Request) {
    nativeRequest(req);
    return this.telemetry.config(req.get('x-fleet-device-token') ?? '');
  }
  @Post('streams')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async start(@Req() req: Request, @Body() body: unknown) {
    const c = await this.auth.authenticateNative(bearer(req));
    return this.telemetry.start(c, body);
  }
  @Post('batches')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  batch(@Req() req: Request, @Body() body: unknown) {
    nativeRequest(req);
    return this.telemetry.ingest(req.get('x-fleet-device-token') ?? '', body);
  }
}
@Controller('admin/telemetry')
@UseGuards(PermissionsGuard)
export class AdminTelemetryController {
  constructor(
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
  ) {}
  @Get('latest')
  @RequirePermissions('fleet_map.read')
  @Header('Cache-Control', 'private, no-store')
  latest() {
    return this.telemetry.latest();
  }
  @Get('trucks/:id/streams')
  @RequirePermissions('fleet_map.read')
  @Header('Cache-Control', 'private, no-store')
  streams(@Param('id') id: string) {
    return this.telemetry.streams(id);
  }
  @Get('streams/:id/integrity')
  @RequirePermissions('fleet_map.read')
  @Header('Cache-Control', 'private, no-store')
  integrity(@Param('id') id: string) {
    return this.telemetry.integrity(id);
  }
  @Get('trucks/:id/history')
  @RequirePermissions('fleet_map.read')
  @Header('Cache-Control', 'private, no-store')
  history(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.telemetry.history(id, from, to, cursor);
  }
}
