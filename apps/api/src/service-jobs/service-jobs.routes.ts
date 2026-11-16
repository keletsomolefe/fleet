import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../auth/admin-session.js';
import { BadRequestError, HttpError } from '../http/errors.js';
import { header, privateResponse, uuidParam } from '../http/request.js';
import type { ServiceJobsService } from './service-jobs.service.js';
import type { UploadedPhoto } from '../storage/photo.js';
import {
  parseProgressInput,
  parseProviderNameInput,
} from './service-job.input.js';

const read = ['service_jobs.read'];
const write = ['service_jobs.write'];
const providerRead = ['service_providers.read'];
const providerWrite = ['service_providers.write'];

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
const bearer = (request: FastifyRequest) =>
  header(request, 'authorization')?.replace(/^Bearer /, '') ?? '';

export function registerAdminServiceJobRoutes(
  app: FastifyInstance,
  jobs: ServiceJobsService,
) {
  app.get('/service-jobs', { config: { permissions: read } }, async (r) =>
    jobs.listJobs(r.query as Record<string, unknown>),
  );
  app.get('/service-jobs/summary', { config: { permissions: read } }, async () =>
    jobs.summary(),
  );
  app.post('/service-jobs', { config: { permissions: write } }, async (r, reply) => {
    reply.code(201);
    return jobs.createJob(requireAdmin(r), r.body);
  });
  app.get<{ Params: { id: string } }>(
    '/service-jobs/:id',
    { config: { permissions: read } },
    async (r) => jobs.getJob(uuidParam(r.params.id)),
  );
  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/broadcast',
    { config: { permissions: write } },
    async (r) => jobs.broadcast(requireAdmin(r), uuidParam(r.params.id)),
  );
  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/assign',
    { config: { permissions: write } },
    async (r) =>
      jobs.assignProvider(requireAdmin(r), uuidParam(r.params.id), r.body),
  );
  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/cancel',
    { config: { permissions: write } },
    async (r) => jobs.cancelJob(requireAdmin(r), uuidParam(r.params.id), r.body),
  );
  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/close',
    { config: { permissions: write } },
    async (r) => jobs.closeJob(requireAdmin(r), uuidParam(r.params.id), r.body),
  );
  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/reopen',
    { config: { permissions: write } },
    async (r) => jobs.reopenJob(requireAdmin(r), uuidParam(r.params.id), r.body),
  );
  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/notes',
    { config: { permissions: write } },
    async (r) => jobs.addNote(requireAdmin(r), uuidParam(r.params.id), r.body),
  );
  app.post<{ Params: { id: string; offerId: string } }>(
    '/service-jobs/:id/offers/:offerId/resend',
    { config: { permissions: write } },
    async (r) =>
      jobs.resendOffer(requireAdmin(r), uuidParam(r.params.offerId)),
  );
  app.post<{ Params: { id: string; offerId: string } }>(
    '/service-jobs/:id/offers/:offerId/revoke',
    { config: { permissions: write } },
    async (r) => jobs.revokeLink(requireAdmin(r), uuidParam(r.params.offerId)),
  );
  app.get<{ Params: { id: string; offerId: string } }>(
    '/service-jobs/:id/offers/:offerId/link',
    { config: { permissions: write } },
    async (r) => jobs.copyLink(uuidParam(r.params.offerId)),
  );
  app.get<{ Params: { id: string; photoId: string } }>(
    '/service-jobs/:id/photos/:photoId',
    { config: { permissions: read } },
    async (r, reply) =>
      sendPhoto(
        reply,
        await jobs.adminPhoto(
          uuidParam(r.params.id),
          uuidParam(r.params.photoId),
        ),
      ),
  );

  app.get(
    '/service-providers',
    { config: { permissions: providerRead } },
    async (r) => jobs.listProviders(r.query as Record<string, unknown>),
  );
  app.post(
    '/service-providers',
    { config: { permissions: providerWrite } },
    async (r, reply) => {
      reply.code(201);
      return jobs.createProvider(requireAdmin(r), r.body);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/service-providers/:id',
    { config: { permissions: providerRead } },
    async (r) => jobs.getProvider(uuidParam(r.params.id), requireAdmin(r).permissions.includes('service_jobs.read')),
  );
  app.patch<{ Params: { id: string } }>(
    '/service-providers/:id',
    { config: { permissions: providerWrite } },
    async (r) =>
      jobs.updateProvider(requireAdmin(r), uuidParam(r.params.id), r.body),
  );
  app.post<{ Params: { id: string } }>(
    '/service-providers/:id/status',
    { config: { permissions: providerWrite } },
    async (r) =>
      jobs.setProviderStatus(requireAdmin(r), uuidParam(r.params.id), r.body),
  );
  app.post<{ Params: { id: string } }>(
    '/service-providers/:id/consent',
    { config: { permissions: providerWrite } },
    async (r) =>
      jobs.confirmProviderConsent(
        requireAdmin(r),
        uuidParam(r.params.id),
        r.body,
      ),
  );
}

async function readUpload(request: FastifyRequest) {
  const files: UploadedPhoto[] = [];
  if (!request.isMultipart()) return { body: request.body, files };
  const body: Record<string, unknown> = Object.create(null);
  const errors = request.server.multipartErrors;
  try {
    for await (const part of request.parts({
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 3,
        fields: 4,
        fieldSize: 5000,
        parts: 7,
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
    throw new BadRequestError('Invalid upload.');
  }
  return { body, files };
}

export function registerPublicServiceJobRoutes(
  app: FastifyInstance,
  jobs: ServiceJobsService,
) {
  app.addHook('onRequest', privateResponse);
  const requireCode = (request: FastifyRequest) => {
    const value = bearer(request);
    if (!value) throw new BadRequestError('Open the job link from WhatsApp.');
    return value;
  };
  app.get('/public/service-job', async (r) =>
    jobs.providerViewByCode(requireCode(r)),
  );
  app.post('/public/service-job/accept', async (r) => {
    const { name } = parseProviderNameInput(r.body);
    return jobs.acceptByCode(requireCode(r), { responderName: name });
  });
  app.post('/public/service-job/decline', async (r) => {
    const { name } = parseProviderNameInput(r.body);
    return jobs.declineByCode(requireCode(r), { responderName: name });
  });
  app.post('/public/service-job/progress', async (r) => {
    const { stage } = parseProgressInput(r.body);
    return jobs.progressByCode(requireCode(r), stage);
  });
  app.post('/public/service-job/complete', async (r) => {
    const { body, files } = await readUpload(r);
    return jobs.completeByCode(requireCode(r), body, files);
  });
  app.get<{ Params: { photoId: string } }>(
    '/public/service-job/photos/:photoId',
    async (r, reply) =>
      sendPhoto(
        reply,
        await jobs.providerPhoto(requireCode(r), uuidParam(r.params.photoId)),
      ),
  );
}
