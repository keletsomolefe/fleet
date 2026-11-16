import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAdmin } from '../auth/admin-session.js';
import { BadRequestError, HttpError } from '../http/errors.js';
import type { RepairsService, RepairPhoto } from './repairs.service.js';

type IssueParams = { Params: { id: string } };
const readPermissions = ['admin.access', 'issues.read'];
const resolvePermissions = [...readPermissions, 'issues.resolve'];

async function readUpload(request: FastifyRequest) {
  const files: RepairPhoto[] = [];
  if (!request.isMultipart()) return { body: request.body, files };

  const body: Record<string, unknown> = Object.create(null);
  const errors = request.server.multipartErrors;
  try {
    for await (const part of request.parts({
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 3,
        fields: 1,
        fieldSize: 5000,
        parts: 5,
      },
    })) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname !== 'photos')
          throw new BadRequestError('Unexpected field');
        files.push({ buffer, mimetype: part.mimetype, size: buffer.length });
      } else {
        if (part.fieldnameTruncated || part.valueTruncated)
          throw new BadRequestError('Field value too long');
        if (Object.hasOwn(body, part.fieldname))
          throw new BadRequestError('Unexpected field');
        body[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof errors.RequestFileTooLargeError)
      throw new HttpError('File too large', 413);
    if (error instanceof errors.FilesLimitError)
      throw new BadRequestError('Too many files');
    if (error instanceof errors.FieldsLimitError)
      throw new BadRequestError('Too many fields');
    if (error instanceof errors.PartsLimitError)
      throw new BadRequestError('Too many parts');
    throw new BadRequestError('Invalid repair form.');
  }
  return { body, files };
}

export function registerAdminRepairRoutes(
  app: FastifyInstance,
  repairs: RepairsService,
) {
  app.post<IssueParams>(
    '/issues/:id/repair/resolve',
    { config: { permissions: resolvePermissions } },
    async (request) => {
      const { body, files } = await readUpload(request);
      return repairs.resolve(request.params.id, body, files, {
        admin: requireAdmin(request),
      });
    },
  );
}
