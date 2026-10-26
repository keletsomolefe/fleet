import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type AdminRequest } from '../auth/auth.service.js';
import { bearer } from '../mobile/mobile.input.js';
import { TransportService } from './transport.service.js';

@Controller('admin/transport')
export class AdminTransportController {
  constructor(
    @Inject(TransportService) private readonly transport: TransportService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get('catalogue')
  @Header('Cache-Control', 'private, no-store')
  catalogue(@Req() r: AdminRequest) {
    return this.transport.catalogue(r.adminContext!);
  }
  @Post('master/:kind')
  create(
    @Req() r: AdminRequest,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(r);
    return this.transport.saveMaster(r.adminContext!, kind, body);
  }
  @Patch('master/:kind/:id')
  update(
    @Req() r: AdminRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(r);
    return this.transport.saveMaster(r.adminContext!, kind, body, id);
  }
  @Get('rates')
  @Header('Cache-Control', 'private, no-store')
  rates(@Req() r: AdminRequest) {
    return this.transport.rates(r.adminContext!);
  }
  @Post('rates')
  rate(@Req() r: AdminRequest, @Body() body: unknown) {
    this.auth.verifyCsrf(r);
    return this.transport.saveRate(r.adminContext!, body);
  }
  @Patch('rates/:id')
  endRate(
    @Req() r: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(r);
    return this.transport.endRate(r.adminContext!, id, body);
  }
  @Get('dispatches')
  @Header('Cache-Control', 'private, no-store')
  jobs(@Req() r: AdminRequest) {
    return this.transport.dispatches(r.adminContext!);
  }
  @Post('dispatches')
  dispatch(@Req() r: AdminRequest, @Body() body: unknown) {
    this.auth.verifyCsrf(r);
    return this.transport.saveDispatch(r.adminContext!, body);
  }
  @Patch('dispatches/:id')
  editDispatch(
    @Req() r: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(r);
    return this.transport.saveDispatch(r.adminContext!, body, id);
  }
  @Get('records')
  @Header('Cache-Control', 'private, no-store')
  records(@Req() r: AdminRequest) {
    return this.transport.records(r.adminContext!);
  }
  @Get('records/:id')
  @Header('Cache-Control', 'private, no-store')
  record(@Req() r: AdminRequest, @Param('id') id: string) {
    return this.transport.record(r.adminContext!, id);
  }
  @Post('records/:id/review')
  review(
    @Req() r: AdminRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.auth.verifyCsrf(r);
    return this.transport.review(r.adminContext!, id, body);
  }
  @Get('earnings')
  @Header('Cache-Control', 'private, no-store')
  earnings(
    @Req() r: AdminRequest,
    @Query('month') month: string,
    @Query('truckId') truck?: string,
  ) {
    return this.transport.earnings(r.adminContext!, month, truck);
  }
}
@Controller('mobile/transport')
export class MobileTransportController {
  constructor(
    @Inject(TransportService) private readonly transport: TransportService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get('catalogue')
  @Header('Cache-Control', 'private, no-store')
  async catalogue(@Req() r: Request) {
    return this.transport.catalogue(
      await this.auth.authenticateNative(bearer(r)),
      true,
    );
  }
  @Get('dispatches')
  @Header('Cache-Control', 'private, no-store')
  async jobs(@Req() r: Request) {
    return this.transport.dispatches(
      await this.auth.authenticateNative(bearer(r)),
      true,
    );
  }
  @Post('contexts')
  async context(@Req() r: Request, @Body() body: unknown) {
    return this.transport.recordingContext(
      await this.auth.authenticateNative(bearer(r)),
      body,
    );
  }
  @Post('batches')
  upload(@Req() r: Request, @Body() body: unknown) {
    return this.transport.upload(body, r.headers['x-fleet-recording-token']);
  }
  @Get('reviews')
  @Header('Cache-Control', 'private, no-store')
  async reviews(@Req() r: Request, @Query('ids') ids = '') {
    return this.transport.reviewResults(
      await this.auth.authenticateNative(bearer(r)),
      ids,
    );
  }
}
