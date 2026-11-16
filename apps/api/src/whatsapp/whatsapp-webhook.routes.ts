import type { FastifyInstance } from 'fastify';
import { privateResponse } from '../http/request.js';
import type { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

export function registerWhatsAppWebhookRoutes(
  app: FastifyInstance,
  webhook: WhatsAppWebhookService,
) {
  app.register(async (scope) => {
    scope.addHook('onRequest', privateResponse);
    // Let Fastify enforce the byte limit, but do not parse JSON until the
    // signature has been checked over exactly the bytes received.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    scope.get('/whatsapp/webhook', async (request, reply) => {
      const query = new URLSearchParams(
        (request.raw.url ?? '').split('?')[1] ?? '',
      );
      return reply
        .type('text/plain; charset=utf-8')
        .send(webhook.handleGet(query));
    });
    scope.post(
      '/whatsapp/webhook',
      { bodyLimit: 1024 * 1024 },
      async (request, reply) => {
        const signature = request.headers['x-hub-signature-256'];
        const result = await webhook.handlePost(
          Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
          typeof signature === 'string' ? signature : undefined,
        );
        return reply.type('text/plain; charset=utf-8').send(result);
      },
    );
  });
}
