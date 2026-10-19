import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { MobileAuthService } from './mobile-auth.service.js';
import { MobileDeviceService } from './mobile-device.service.js';
import { bearer, nativeRequest } from './mobile.input.js';

@Controller('mobile')
export class MobileController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MobileAuthService) private readonly mobileAuth: MobileAuthService,
    @Inject(MobileDeviceService) private readonly devices: MobileDeviceService,
  ) {}
  @Post('auth/login')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  login(@Body() body: unknown, @Req() req: Request) {
    nativeRequest(req);
    return this.mobileAuth.login(body, req.ip ?? 'unknown');
  }
  @Delete('auth/session')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  logout(@Req() req: Request) {
    return this.mobileAuth.logout(bearer(req));
  }
  @Get('auth/session')
  @Header('Cache-Control', 'private, no-store')
  async session(@Req() req: Request) {
    const c = await this.auth.authenticateNative(bearer(req));
    return {
      user: this.auth.profile(c.user),
      mode: await this.mobileAuth.resolveMode(c),
      permissions: c.permissions,
      expiresAt: c.session.expires_at ?? null,
    };
  }
  @Get('device')
  @Header('Cache-Control', 'private, no-store')
  device(@Req() req: Request) {
    nativeRequest(req);
    return this.devices.deviceContext(req.get('x-fleet-device-token') ?? '');
  }
  @Get('setup/trucks')
  @Header('Cache-Control', 'private, no-store')
  async trucks(
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('page') page?: string,
  ) {
    const c = await this.auth.authenticateNative(bearer(req));
    this.mobileAuth.requireSetup(c);
    return this.devices.trucks(q, page);
  }
  @Post('setup/device')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async enroll(@Req() req: Request, @Body() body: unknown) {
    const c = await this.auth.authenticateNative(bearer(req));
    this.mobileAuth.requireSetup(c);
    return this.devices.enroll(body, c);
  }
  @Get('driver/truck')
  @Header('Cache-Control', 'private, no-store')
  async truck(@Req() req: Request) {
    const c = await this.auth.authenticateNative(bearer(req));
    return this.devices.driverContext(c, req.get('x-fleet-device-token') ?? '');
  }
  @Post('driver/truck/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async confirm(@Req() req: Request, @Body() body: unknown) {
    const c = await this.auth.authenticateNative(bearer(req));
    return this.devices.confirm(c, req.get('x-fleet-device-token') ?? '', body);
  }
}
