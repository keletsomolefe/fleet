import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type AdminRequest } from '../auth/auth.service.js';
import { bearer } from '../mobile/mobile.input.js';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../rbac/permissions.guard.js';
import { IssuesService } from './issues.service.js';

@Controller('mobile')
export class MobileIssuesController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(IssuesService) private readonly issues: IssuesService,
  ) {}
  @Header('Cache-Control', 'private, no-store')
  @Post('driver/issues')
  @HttpCode(200)
  async report(@Req() r: Request, @Body() body: unknown) {
    return this.issues.report(
      await this.auth.authenticateNative(bearer(r)),
      body,
    );
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('driver/issues')
  async own(@Req() r: Request) {
    return this.issues.list(
      await this.auth.authenticateNative(bearer(r)),
      true,
    );
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('admin/issues')
  async list(@Req() r: Request) {
    return this.issues.list(await this.auth.authenticateNative(bearer(r)));
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('admin/issues/:id/resolve')
  @HttpCode(200)
  async resolve(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.issues.resolve(
      await this.auth.authenticateNative(bearer(r)),
      id,
      body,
    );
  }
}

@Controller('admin/issues')
@UseGuards(PermissionsGuard)
@RequirePermissions('admin.access', 'trucks.read', 'trucks.write')
export class AdminIssuesController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(IssuesService) private readonly issues: IssuesService,
  ) {}
  @Header('Cache-Control', 'private, no-store')
  @Get()
  list(@Req() r: AdminRequest) {
    return this.issues.list(r.adminContext!);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @Req() r: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(r);
    return this.issues.resolve(r.adminContext!, id, body);
  }
}
