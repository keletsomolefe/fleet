import multipart from '@fastify/multipart';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { BadRequestError } from '../../../shared/errors.js';
import {
  header,
  privateResponse,
  readPhotoUpload,
  sendPrivatePhoto,
} from '../../../shared/http.js';
import {
  uuidIdParamsSchema,
  uuidParamsSchema,
} from '../../../shared/validation.js';
import type { ServiceJobsService } from '../application/service-jobs.service.js';
import {
  parseProgressInput,
  parseProviderNameInput,
} from './service-job.dto.js';

declare module 'fastify' {
  interface FastifyRequest {
    jobAccessCode: string | null;
  }
}

const read = ['service_jobs.read'] as const;
const write = ['service_jobs.write'] as const;
const providerRead = ['service_providers.read'] as const;
const providerWrite = ['service_providers.write'] as const;

const offerParamsSchema = uuidParamsSchema(['id', 'offerId']);
const photoParamsSchema = uuidParamsSchema(['id', 'photoId']);
const publicPhotoParamsSchema = uuidParamsSchema(['photoId']);

export interface ServiceJobsPluginOptions {
  jobs: ServiceJobsService;
}

export const adminServiceJobsPlugin: FastifyPluginAsync<
  ServiceJobsPluginOptions
> = async (app, { jobs }) => {
  app.get('/service-jobs', { config: { permissions: read } }, async (request) =>
    jobs.listJobs(request.query as Record<string, unknown>),
  );

  app.get(
    '/service-jobs/summary',
    { config: { permissions: read } },
    async () => jobs.summary(),
  );

  app.post(
    '/service-jobs',
    { config: { permissions: write } },
    async (request, reply) => {
      reply.code(201);
      return jobs.createJob(requireAdmin(request), request.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/service-jobs/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: read },
    },
    async (request) => jobs.getJob(request.params.id),
  );

  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/broadcast',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: write },
    },
    async (request) => jobs.broadcast(requireAdmin(request), request.params.id),
  );

  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/assign',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: write },
    },
    async (request) =>
      jobs.assignProvider(
        requireAdmin(request),
        request.params.id,
        request.body,
      ),
  );

  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/cancel',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: write },
    },
    async (request) =>
      jobs.cancelJob(requireAdmin(request), request.params.id, request.body),
  );

  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/close',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: write },
    },
    async (request) =>
      jobs.closeJob(requireAdmin(request), request.params.id, request.body),
  );

  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/reopen',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: write },
    },
    async (request) =>
      jobs.reopenJob(requireAdmin(request), request.params.id, request.body),
  );

  app.post<{ Params: { id: string } }>(
    '/service-jobs/:id/notes',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: write },
    },
    async (request) =>
      jobs.addNote(requireAdmin(request), request.params.id, request.body),
  );

  app.post<{ Params: { id: string; offerId: string } }>(
    '/service-jobs/:id/offers/:offerId/resend',
    {
      schema: { params: offerParamsSchema },
      config: { permissions: write },
    },
    async (request) =>
      jobs.resendOffer(requireAdmin(request), request.params.offerId),
  );

  app.post<{ Params: { id: string; offerId: string } }>(
    '/service-jobs/:id/offers/:offerId/revoke',
    {
      schema: { params: offerParamsSchema },
      config: { permissions: write },
    },
    async (request) =>
      jobs.revokeLink(requireAdmin(request), request.params.offerId),
  );

  app.get<{ Params: { id: string; offerId: string } }>(
    '/service-jobs/:id/offers/:offerId/link',
    {
      schema: { params: offerParamsSchema },
      config: { permissions: write },
    },
    async (request) => jobs.copyLink(request.params.offerId),
  );

  app.get<{ Params: { id: string; photoId: string } }>(
    '/service-jobs/:id/photos/:photoId',
    {
      schema: { params: photoParamsSchema },
      config: { permissions: read },
    },
    async (request, reply) =>
      sendPrivatePhoto(
        reply,
        await jobs.adminPhoto(request.params.id, request.params.photoId),
      ),
  );

  app.get(
    '/service-providers',
    { config: { permissions: providerRead } },
    async (request) =>
      jobs.listProviders(request.query as Record<string, unknown>),
  );

  app.post(
    '/service-providers',
    { config: { permissions: providerWrite } },
    async (request, reply) => {
      reply.code(201);
      return jobs.createProvider(requireAdmin(request), request.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/service-providers/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: providerRead },
    },
    async (request) =>
      jobs.getProvider(
        request.params.id,
        requireAdmin(request).permissions.includes('service_jobs.read'),
      ),
  );

  app.patch<{ Params: { id: string } }>(
    '/service-providers/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: providerWrite },
    },
    async (request) =>
      jobs.updateProvider(
        requireAdmin(request),
        request.params.id,
        request.body,
      ),
  );

  app.post<{ Params: { id: string } }>(
    '/service-providers/:id/status',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: providerWrite },
    },
    async (request) =>
      jobs.setProviderStatus(
        requireAdmin(request),
        request.params.id,
        request.body,
      ),
  );

  app.post<{ Params: { id: string } }>(
    '/service-providers/:id/consent',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: providerWrite },
    },
    async (request) =>
      jobs.confirmProviderConsent(
        requireAdmin(request),
        request.params.id,
        request.body,
      ),
  );
};

function requireJobAccessCode(request: FastifyRequest): string {
  if (!request.jobAccessCode) {
    throw new BadRequestError('Open the job link from WhatsApp.');
  }
  return request.jobAccessCode;
}

export const publicServiceJobsPlugin: FastifyPluginAsync<
  ServiceJobsPluginOptions
> = async (app, { jobs }) => {
  app.register(multipart);
  app.addHook('onRequest', privateResponse);
  app.addHook('preHandler', async (request) => {
    const code = header(request, 'authorization')?.replace(/^Bearer /, '') ?? '';
    if (!code) throw new BadRequestError('Open the job link from WhatsApp.');
    request.jobAccessCode = code;
  });

  app.get('/public/service-job', async (request) =>
    jobs.providerViewByCode(requireJobAccessCode(request)),
  );

  app.post('/public/service-job/accept', async (request) => {
    const { name } = parseProviderNameInput(request.body);
    return jobs.acceptByCode(requireJobAccessCode(request), {
      responderName: name,
    });
  });

  app.post('/public/service-job/decline', async (request) => {
    const { name } = parseProviderNameInput(request.body);
    return jobs.declineByCode(requireJobAccessCode(request), {
      responderName: name,
    });
  });

  app.post('/public/service-job/progress', async (request) => {
    const { stage } = parseProgressInput(request.body);
    return jobs.progressByCode(requireJobAccessCode(request), stage);
  });

  app.post('/public/service-job/complete', async (request) => {
    const { body, files } = await readPhotoUpload(request, {
      maxFields: 4,
      maxParts: 7,
      invalidMessage: 'Invalid upload.',
    });
    return jobs.completeByCode(requireJobAccessCode(request), body, files);
  });

  app.get<{ Params: { photoId: string } }>(
    '/public/service-job/photos/:photoId',
    { schema: { params: publicPhotoParamsSchema } },
    async (request, reply) =>
      sendPrivatePhoto(
        reply,
        await jobs.providerPhoto(
          requireJobAccessCode(request),
          request.params.photoId,
        ),
      ),
  );
};
