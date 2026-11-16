import { Database, In } from '../database/database.js';
import { LockMode } from '@mikro-orm/postgresql';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../http/errors.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AdminContext } from '../auth/auth.service.js';
import { drivingId } from '../mobile/driving.input.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import { requireIssues } from '../rbac/issue-access.js';
import { DriverIssue } from './issue.entity.js';
import { repairDataDir, writePrivateJson } from '../storage/private-storage.js';
import { photoType, type UploadedPhoto } from '../storage/photo.js';
import { ServiceJob } from '../service-jobs/service-job.entity.js';

export type RepairPhoto = UploadedPhoto;
type Photo = { id: string; type: string };
type Receipt = {
  resolvedAt: string;
  resolutionNote: string;
  photos: Photo[];
  userId?: string;
};
function repairInput(raw: unknown) {
  const v = raw as { note?: unknown };
  if (
    !v ||
    Object.keys(v).some((k) => k !== 'note') ||
    typeof v.note !== 'string' ||
    !v.note.trim() ||
    v.note.trim().length > 1000
  )
    throw new BadRequestError(
      'Enter a repair comment of up to 1,000 characters.',
    );
  return v.note.trim();
}
export class RepairsService {
  constructor(
    private readonly db: Database,
    private readonly events: OperationsEventsService,
  ) {}
  async resolve(
    id: string,
    raw: unknown,
    files: RepairPhoto[],
    { admin }: { admin: AdminContext },
  ) {
    drivingId(id);
    const note = repairInput(raw);
    if (files.length > 3) throw new BadRequestError('Choose up to 3 photos.');
    const photos = files.map((file) => ({
      id: randomUUID(),
      type: photoType(file),
      buffer: file.buffer,
    }));
    requireIssues(admin, true);
    const userId = admin.user.id;
    const changed = await this.db.transaction(async (m) => {
      const issue = await m.findOne(DriverIssue, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!issue || issue.category !== 'vehicle' || !issue.truckId)
        throw new NotFoundError('Truck issue not found.');
      const activeJob = await m
        .getRepository(ServiceJob)
        .findOne({ where: { issue: id, status: In(['open', 'assigned', 'in_progress']) } });
      if (activeJob)
        throw new ConflictError(
          `This report has an active service job (${activeJob.reference}). Close the job before recording a repair.`,
        );
      if (issue.resolvedAt) {
        // A repeated submit must never replace saved evidence.
        if (
          issue.resolvedById === userId &&
          issue.resolutionNote === note
        )
          return false;
        throw new ConflictError('This issue has already been resolved.');
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
      // The receipt links these files to the database resolution and administrator.
      await writePrivateJson(join(dir, 'receipt.json'), {
        resolvedAt: issue.resolvedAt.toISOString(),
        resolutionNote: note,
        photos: photos.map(({ id, type }) => ({ id, type })),
        userId,
      } satisfies Receipt);
      await m.save(issue);
      return true;
    });
    if (changed) this.events.changed();
    return { id };
  }
}
