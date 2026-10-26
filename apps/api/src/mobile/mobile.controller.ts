import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { MobileAuthService } from './mobile-auth.service.js';
import { bearer, nativeRequest } from './mobile.input.js';

@Controller('mobile')
export class MobileController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MobileAuthService) private readonly mobileAuth: MobileAuthService,
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
  @All([
    'device',
    'setup/trucks',
    'setup/device',
    'driver/truck',
    'driver/truck/confirm',
  ])
  @Header('Cache-Control', 'private, no-store')
  legacy(@Req() req: Request) {
    nativeRequest(req);
    throw new GoneException('Update Fleet to choose a vehicle on your phone.');
  }
}
