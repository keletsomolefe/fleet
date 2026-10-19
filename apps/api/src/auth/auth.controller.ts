import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, type AdminRequest } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('config')
  config(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const publicUrl = new URL(process.env.KRATOS_PUBLIC_URL!);
    const recoveryUrl = new URL('recovery', process.env.KRATOS_UI_URL);
    // Both loopback names are supported in development; cookies must stay on the app's host.
    const loopback = new Set(['localhost', '127.0.0.1']);
    if (
      process.env.NODE_ENV !== 'production' &&
      loopback.has(request.hostname)
    ) {
      if (loopback.has(publicUrl.hostname))
        publicUrl.hostname = request.hostname;
      if (loopback.has(recoveryUrl.hostname))
        recoveryUrl.hostname = request.hostname;
    }
    return {
      kratosPublicUrl: publicUrl.toString(),
      recoveryUrl: recoveryUrl.toString(),
    };
  }

  @Get('session')
  session(
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const context = request.adminContext!;
    return {
      user: this.auth.profile(context.user),
      roles: context.roles,
      permissions: context.permissions,
      csrfToken: this.auth.csrfToken(context),
    };
  }
}
