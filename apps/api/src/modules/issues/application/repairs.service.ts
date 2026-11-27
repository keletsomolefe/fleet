import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LockMode, type MikroORM } from '@mikro-orm/postgresql';
import { getEm } from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../shared/errors.js';
import { photoType, type UploadedPhoto } from '../../../shared/storage/photo.js';
import {
  repairDataDir,
  writePrivateJson,
} from '../../../shared/storage/private-storage.js';
import { drivingId } from '../../driving/http/driving.dto.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { requireIssues } from '../../identity/domain/permissions.js';
import { User } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import {
  activeJobStatuses,
  ServiceJob,
} from '../../service-jobs/domain/service-job.entity.js';
import {
  DriverIssue,
  isIssueResolved,
  isVehicleIssue,
  resolveIssue,
} from '../domain/driver-issue.entity.js';
import { parseRepairResolution } from '../http/issue.dto.js';

export type RepairPhoto = UploadedPhoto;

type PhotoRecord = { id: string; type: string };
type Receipt = {
  resolvedAt: string;
  resolutionNote: string;
  photos: PhotoRecord[];
  userId?: string;
};

export class RepairsService {
  constructor(
    private readonly orm: MikroORM,
    private readonly events: OperationsEventsService,
  ) {}

  async resolve(
    id: string,
    raw: unknown,
    files: RepairPhoto[],
    { admin }: { admin: AdminContext },
  ) {
    drivingId(id);
    const note = parseRepairResolution(raw);
    if (files.length > 3) throw new BadRequestError('Choose up to 3 photos.');
    const photos = files.map((file) => ({
      id: randomUUID(),
      type: photoType(file),
      buffer: file.buffer,
    }));
    requireIssues(admin, true);
    const userId = admin.user.id;

    const changed = await getEm(this.orm).transactional(async (tx) => {
      const issue = await tx.findOne(
        DriverIssue,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!issue || !isVehicleIssue(issue)) {
        throw new NotFoundError('Truck issue not found.');
      }

      const activeJob = await tx.findOne(ServiceJob, {
        issue: id,
        status: { $in: [...activeJobStatuses] },
      });
      if (activeJob) {
        throw new ConflictError(
          `This report has an active service job (${activeJob.reference}). Close the job before recording a repair.`,
        );
      }

      if (isIssueResolved(issue)) {
        // A repeated submit must never replace saved evidence.
        if (issue.resolvedBy?.id === userId && issue.resolutionNote === note) {
          return false;
        }
        throw new ConflictError('This issue has already been resolved.');
      }

      const dir = join(repairDataDir(), id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      for (const photo of photos) {
        await writeFile(join(dir, photo.id), photo.buffer, {
          mode: 0o600,
          flag: 'wx',
        });
      }

      const resolvedAt = new Date();
      resolveIssue(issue, tx.getReference(User, userId), note, resolvedAt);

      // The receipt links these files to the database resolution and administrator.
      await writePrivateJson(join(dir, 'receipt.json'), {
        resolvedAt: resolvedAt.toISOString(),
        resolutionNote: note,
        photos: photos.map(({ id: photoId, type }) => ({ id: photoId, type })),
        userId,
      } satisfies Receipt);

      await tx.flush();
      return true;
    });

    if (changed) this.events.changed();
    return { id };
  }
}
