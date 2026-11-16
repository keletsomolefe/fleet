import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../auth/admin-session.js';
import { BadRequestError, ConflictError, HttpError } from '../http/errors.js';
import { header, privateResponse } from '../http/request.js';
import type { RepairAccess } from './repair-access.js';
import type { RepairOtpService } from './repair-otp.service.js';
import type { RepairsService, RepairPhoto } from './repairs.service.js';

type IssueParams = { Params: { id: string } };
type PhotoParams = { Params: { id: string; photoId: string } };
const readPermissions = ['admin.access', 'issues.read'];
const resolvePermissions = [...readPermissions, 'issues.resolve'];

const repairToken = (request: FastifyRequest) =>
  header(request, 'authorization')?.replace(/^Bearer /, '') ?? '';

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
        fields: 2,
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

function sendPhoto(
  reply: FastifyReply,
  photo: { type: string; buffer: Buffer },
) {
  return reply
    .headers({
      'Content-Type': photo.type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
    })
    .send(photo.buffer);
}

export function registerPublicRepairRoutes(
  app: FastifyInstance,
  repairs: RepairsService,
  access: RepairAccess,
  otp: RepairOtpService,
) {
  app.addHook('onRequest', privateResponse);
  const verifyLink = async (request: FastifyRequest<IssueParams>) => {
    access.verify(repairToken(request), request.params.id);
  };

  app.get<IssueParams>(
    '/repairs/:id',
    { preHandler: verifyLink },
    async (request) => repairs.view(request.params.id),
  );
  app.post<IssueParams>(
    '/repairs/:id/otp',
    { preHandler: verifyLink },
    async (request) => {
      const { id } = request.params;
      if ((await repairs.issue(id)).resolvedAt)
        throw new ConflictError('This issue has already been resolved.');
      return otp.request(id, request.body);
    },
  );
  app.post<IssueParams>(
    '/repairs/:id/otp/verify',
    { preHandler: verifyLink },
    async (request) => otp.verify(request.params.id, request.body),
  );
  app.get<PhotoParams>(
    '/repairs/:id/photos/:photoId',
    { preHandler: verifyLink },
    async ({ params: { id, photoId } }, reply) =>
      sendPhoto(reply, await repairs.photo(id, photoId)),
  );
  app.post<IssueParams>('/repairs/:id/resolve', async (request) => {
    const { id } = request.params;
    const claim = access.verify(repairToken(request), id, 'repair');
    const { body, files } = await readUpload(request);
    return repairs.resolve(id, body, files, { phone: claim.phone! });
  });
}

export function registerAdminRepairRoutes(
  app: FastifyInstance,
  repairs: RepairsService,
) {
  app.get('/repairs', { config: { permissions: readPermissions } }, async () =>
    repairs.history(),
  );
  app.get<IssueParams>(
    '/issues/:id/repair',
    { config: { permissions: readPermissions } },
    async (request) => repairs.view(request.params.id),
  );
  app.get<PhotoParams>(
    '/issues/:id/repair/photos/:photoId',
    { config: { permissions: readPermissions } },
    async ({ params: { id, photoId } }, reply) =>
      sendPhoto(reply, await repairs.photo(id, photoId)),
  );
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
