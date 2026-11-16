import {
  Body,
  CanActivate,
  Controller,
  ConflictException,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AuthService, type AdminRequest } from '../auth/auth.service.js';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../rbac/permissions.guard.js';
import { RepairAccess } from './repair-access.js';
import { RepairOtpService } from './repair-otp.service.js';
import { RepairsService, type RepairPhoto } from './repairs.service.js';

const photos = () =>
  FilesInterceptor('photos', 3, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 3,
      fields: 2,
      fieldSize: 5000,
      parts: 5,
    },
  });
const token = (r: Request) =>
  r.get('authorization')?.replace(/^Bearer /, '') ?? '';
const idFrom = (r: Request) => String(r.params.id ?? '');
@Injectable()
export class RepairLinkGuard implements CanActivate {
  constructor(@Inject(RepairAccess) private readonly access: RepairAccess) {}
  canActivate(context: ExecutionContext) {
    const r = context.switchToHttp().getRequest<Request>();
    this.access.verify(token(r), idFrom(r));
    return true;
  }
}
@Injectable()
export class RepairSubmitGuard implements CanActivate {
  constructor(@Inject(RepairAccess) private readonly access: RepairAccess) {}
  canActivate(context: ExecutionContext) {
    const r = context.switchToHttp().getRequest<Request>();
    this.access.verify(token(r), idFrom(r), 'repair');
    return true;
  }
}
@Injectable()
export class RepairCsrfGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  canActivate(context: ExecutionContext) {
    this.auth.verifyCsrf(context.switchToHttp().getRequest<AdminRequest>());
    return true;
  }
}
function sendPhoto(
  response: Response,
  photo: { type: string; buffer: Buffer },
) {
  response
    .set({
      'Content-Type': photo.type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
    })
    .send(photo.buffer);
}
@Controller('repairs/:id')
@UseGuards(RepairLinkGuard)
export class RepairsController {
  constructor(
    @Inject(RepairsService) private readonly repairs: RepairsService,
    @Inject(RepairAccess) private readonly access: RepairAccess,
    @Inject(RepairOtpService) private readonly otp: RepairOtpService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  view(@Param('id') id: string) {
    return this.repairs.view(id);
  }
  @Post('otp')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async request(@Param('id') id: string, @Body() body: unknown) {
    if ((await this.repairs.issue(id)).resolvedAt)
      throw new ConflictException('This issue has already been resolved.');
    return this.otp.request(id, body);
  }
  @Post('otp/verify')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  verify(@Param('id') id: string, @Body() body: unknown) {
    return this.otp.verify(id, body);
  }
  @Get('photos/:photoId')
  @Header('Cache-Control', 'private, no-store')
  async photo(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Res() response: Response,
  ) {
    sendPhoto(response, await this.repairs.photo(id, photoId));
  }
  @Post('resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(RepairSubmitGuard)
  @UseInterceptors(photos())
  resolve(
    @Param('id') id: string,
    @Req() r: Request,
    @Body() body: unknown,
    @UploadedFiles() files: RepairPhoto[],
  ) {
    const claim = this.access.verify(token(r), id, 'repair');
    return this.repairs.resolve(id, body, files ?? [], { phone: claim.phone! });
  }
}
@Controller('admin/issues/:id/repair')
@UseGuards(PermissionsGuard)
@RequirePermissions('admin.access', 'issues.read')
export class AdminRepairsController {
  constructor(
    @Inject(RepairsService) private readonly repairs: RepairsService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  view(@Param('id') id: string) {
    return this.repairs.view(id);
  }
  @Get('photos/:photoId')
  @Header('Cache-Control', 'private, no-store')
  async photo(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Res() response: Response,
  ) {
    sendPhoto(response, await this.repairs.photo(id, photoId));
  }
  @Post('resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('admin.access', 'issues.read', 'issues.resolve')
  @UseGuards(RepairCsrfGuard)
  @UseInterceptors(photos())
  resolve(
    @Param('id') id: string,
    @Req() r: AdminRequest,
    @Body() body: unknown,
    @UploadedFiles() files: RepairPhoto[],
  ) {
    return this.repairs.resolve(id, body, files ?? [], {
      admin: r.adminContext!,
    });
  }
}

@Controller('admin/repairs')
@UseGuards(PermissionsGuard)
@RequirePermissions('admin.access', 'issues.read')
export class RepairHistoryController {
  constructor(
    @Inject(RepairsService) private readonly repairs: RepairsService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  history() {
    return this.repairs.history();
  }
}
