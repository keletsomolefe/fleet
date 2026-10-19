import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { AuthService, type AdminRequest } from './auth.service.js';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async use(request: AdminRequest, response: Response, next: NextFunction) {
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      request.adminContext = await this.auth.authenticate(
        request.headers.cookie,
      );
      next();
    } catch (error) {
      next(error);
    }
  }
}
