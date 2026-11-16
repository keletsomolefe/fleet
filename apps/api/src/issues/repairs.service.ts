import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource, Not, IsNull } from 'typeorm';
import type { AdminContext } from '../auth/auth.service.js';
import { drivingId } from '../mobile/driving.input.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import { requireIssues } from '../rbac/issue-access.js';
import { DriverIssue } from './issue.entity.js';
import { User } from '../users/user.entity.js';
import { repairAuditEmail } from './repair-audit.js';
import { repairDataDir, writePrivateJson } from './openwa.service.js';
import { RepairOtpService } from './repair-otp.service.js';

export type RepairPhoto = { buffer: Buffer; mimetype: string; size: number };
type Photo = { id: string; type: string };
type Receipt = {
  resolvedAt: string;
  resolutionNote: string;
  photos: Photo[];
  verifiedPhone?: string;
  mechanicName?: string;
  userId?: string;
};
export function photoType(file: RepairPhoto) {
  const b = file.buffer;
  if (!b?.length || b.length > 5 * 1024 * 1024)
    throw new BadRequestException('Each photo must be 5 MB or smaller.');
  if (
    file.mimetype === 'image/jpeg' &&
    b[0] === 0xff &&
    b[1] === 0xd8 &&
    b[b.length - 2] === 0xff &&
    b[b.length - 1] === 0xd9
  )
    return 'image/jpeg';
  if (
    file.mimetype === 'image/png' &&
    b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  )
    return 'image/png';
  if (
    file.mimetype === 'image/webp' &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new BadRequestException('Choose JPG, PNG or WebP photos.');
}
function repairInput(raw: unknown) {
  const v = raw as { name?: unknown; note?: unknown };
  if (
    !v ||
    Object.keys(v).some((k) => !['name', 'note'].includes(k)) ||
    typeof v.note !== 'string' ||
    !v.note.trim() ||
    v.note.trim().length > 1000 ||
    (v.name !== undefined &&
      (typeof v.name !== 'string' || v.name.trim().length > 80))
  )
    throw new BadRequestException(
      'Enter a repair comment of up to 1,000 characters.',
    );
  return {
    note: v.note.trim(),
    name:
      typeof v.name === 'string' ? v.name.trim().replace(/[\r\n]/g, ' ') : '',
  };
}
@Injectable()
export class RepairsService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(RepairOtpService) private readonly otp: RepairOtpService,
    @Inject(OperationsEventsService)
    private readonly events: OperationsEventsService,
  ) {}
  async history() {
    const issues = await this.db.getRepository(DriverIssue).find({
      where: { category: 'vehicle', resolvedAt: Not(IsNull()) },
      relations: { truck: true, driver: { user: true }, resolvedBy: true },
      order: { resolvedAt: 'DESC', id: 'DESC' },
      take: 100,
    });
    return {
      items: await Promise.all(
        issues.map(async (issue) => {
          const receipt = await this.receipt(issue);
          return {
            id: issue.id,
            truck: issue.truck
              ? {
                  registration: issue.truck.registration,
                  identifier: issue.truck.identifier,
                }
              : null,
            description: issue.description,
            createdAt: issue.createdAt,
            resolvedAt: issue.resolvedAt,
            requestedBy: `${issue.driver.user.firstName} ${issue.driver.user.lastName}`,
            verifiedPhone: receipt?.verifiedPhone ?? null,
            mechanicName: receipt?.mechanicName ?? null,
            resolvedBy: issue.resolvedBy
              ? `${issue.resolvedBy.firstName} ${issue.resolvedBy.lastName}`
              : null,
            resolutionNote: issue.resolutionNote,
            photos: receipt?.photos.map((p) => p.id) ?? [],
          };
        }),
      ),
    };
  }
  async issue(id: string) {
    drivingId(id);
    const issue = await this.db
      .getRepository(DriverIssue)
      .findOne({ where: { id }, relations: { truck: true } });
    if (!issue || issue.category !== 'vehicle' || !issue.truckId)
      throw new NotFoundException('Truck issue not found.');
    return issue;
  }
  private async receipt(issue: DriverIssue): Promise<Receipt | null> {
    if (!issue.resolvedAt) return null;
    try {
      const receipt = JSON.parse(
        await readFile(join(repairDataDir(), issue.id, 'receipt.json'), 'utf8'),
      ) as Receipt;
      return receipt.resolvedAt === issue.resolvedAt.toISOString() &&
        receipt.resolutionNote === issue.resolutionNote
        ? receipt
        : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async view(id: string) {
    const issue = await this.issue(id),
      receipt = await this.receipt(issue);
    return {
      id: issue.id,
      truck: issue.truck
        ? {
            registration: issue.truck.registration,
            identifier: issue.truck.identifier,
          }
        : null,
      description: issue.description,
      createdAt: issue.createdAt,
      resolvedAt: issue.resolvedAt,
      resolutionNote: issue.resolutionNote,
      photos: receipt?.photos.map((p) => p.id) ?? [],
    };
  }
  async photo(id: string, photoId: string) {
    drivingId(photoId);
    const receipt = await this.receipt(await this.issue(id)),
      photo = receipt?.photos.find((p) => p.id === photoId);
    if (!photo) throw new NotFoundException('Photo not found.');
    return {
      type: photo.type,
      buffer: await readFile(join(repairDataDir(), id, photoId)),
    };
  }
  async resolve(
    id: string,
    raw: unknown,
    files: RepairPhoto[],
    identity: { phone: string } | { admin: AdminContext },
  ) {
    drivingId(id);
    const v = repairInput(raw);
    if (files.length > 3)
      throw new BadRequestException('Choose up to 3 photos.');
    const photos = files.map((file) => ({
      id: randomUUID(),
      type: photoType(file),
      buffer: file.buffer,
    }));
    if ('admin' in identity) requireIssues(identity.admin, true);
    else await this.otp.requireMember(identity.phone); // Membership may have changed after the OTP was issued.
    const note = v.note;
    let userId: string;
    if ('admin' in identity) userId = identity.admin.user.id;
    else {
      const audit = await this.db
        .getRepository(User)
        .findOneBy({ email: repairAuditEmail, isActive: false });
      if (!audit)
        throw new ServiceUnavailableException(
          'Repair recording is unavailable. Please contact the office.',
        );
      userId = audit.id;
    }
    const changed = await this.db.transaction(async (m) => {
      const issue = await m.findOne(DriverIssue, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!issue || issue.category !== 'vehicle' || !issue.truckId)
        throw new NotFoundException('Truck issue not found.');
      if (issue.resolvedAt) {
        // A repeated submit must never replace the first mechanic's evidence.
        if (
          issue.resolvedById === userId &&
          issue.resolutionNote === note &&
          (!('phone' in identity) ||
            (await this.receipt(issue))?.verifiedPhone === identity.phone)
        )
          return false;
        throw new ConflictException('This issue has already been resolved.');
      }
      const dir = join(repairDataDir(), id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      for (const photo of photos)
        await writeFile(join(dir, photo.id), photo.buffer, {
          mode: 0o600,
          flag: 'wx',
        });
      issue.resolvedAt = new Date();
      issue.resolvedById = userId;
      issue.resolutionNote = note;
      // Receipt is visible only if it matches the committed DB resolution; a rollback cannot expose it.
      await writePrivateJson(join(dir, 'receipt.json'), {
        resolvedAt: issue.resolvedAt.toISOString(),
        resolutionNote: note,
        photos: photos.map(({ id, type }) => ({ id, type })),
        ...('phone' in identity
          ? { verifiedPhone: identity.phone, mechanicName: v.name }
          : { userId: identity.admin.user.id }),
      } satisfies Receipt);
      await m.save(issue);
      return true;
    });
    if (changed) this.events.changed();
    return { id };
  }
}
