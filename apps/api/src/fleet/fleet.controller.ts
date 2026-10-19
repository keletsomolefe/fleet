import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService, type AdminRequest } from '../auth/auth.service.js';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../rbac/permissions.guard.js';
import { FleetService } from './fleet.service.js';

@Controller('admin/trucks')
@UseGuards(PermissionsGuard)
export class TrucksController {
  constructor(
    @Inject(FleetService) private readonly fleet: FleetService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get()
  @RequirePermissions('trucks.read')
  list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    return this.fleet.listTrucks(q, page, status);
  }
  @Get(':id')
  @RequirePermissions('trucks.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.fleet.getTruck(id);
  }
  @Post()
  @RequirePermissions('trucks.read', 'trucks.write')
  create(@Body() input: unknown, @Req() request: AdminRequest) {
    this.auth.verifyCsrf(request);
    return this.fleet.saveTruck(input, request.adminContext!.user);
  }
  @Patch(':id')
  @RequirePermissions('trucks.read', 'trucks.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() request: AdminRequest,
  ) {
    this.auth.verifyCsrf(request);
    return this.fleet.saveTruck(input, request.adminContext!.user, id);
  }
}

@Controller('admin/drivers')
@UseGuards(PermissionsGuard)
export class DriversController {
  constructor(
    @Inject(FleetService) private readonly fleet: FleetService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get()
  @RequirePermissions('drivers.read')
  list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('status') status?: string,
  ) {
    return this.fleet.listDrivers(q, page, status);
  }
  @Get('users')
  @RequirePermissions('drivers.read', 'drivers.write')
  users(@Query('q') q?: string) {
    return this.fleet.candidateUsers(q);
  }
  @Get('trucks')
  @RequirePermissions('drivers.read', 'drivers.write')
  trucks(
    @Query('q') q?: string,
    @Query('driverId', new ParseUUIDPipe({ optional: true })) driverId?: string,
  ) {
    return this.fleet.availableTrucks(q, driverId);
  }
  @Get(':id')
  @RequirePermissions('drivers.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.fleet.getDriver(id);
  }
  @Post()
  @RequirePermissions('drivers.read', 'drivers.write')
  create(@Body() input: unknown, @Req() request: AdminRequest) {
    this.auth.verifyCsrf(request);
    return this.fleet.saveDriver(
      input,
      request.adminContext!.user,
      undefined,
      request.adminContext!.permissions.includes('users.create'),
    );
  }
  @Patch(':id')
  @RequirePermissions('drivers.read', 'drivers.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() request: AdminRequest,
  ) {
    this.auth.verifyCsrf(request);
    return this.fleet.saveDriver(input, request.adminContext!.user, id);
  }
}
