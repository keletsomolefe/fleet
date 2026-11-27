import type { FastifyPluginAsync } from 'fastify';
import { privateResponse } from '../../../shared/http.js';
import type { WhatsAppWebhookService } from '../application/whatsapp-webhook.service.js';

export interface WhatsAppWebhookPluginOptions {
  webhook: WhatsAppWebhookService;
}

export const whatsappWebhookPlugin: FastifyPluginAsync<
  WhatsAppWebhookPluginOptions
> = async (app, { webhook }) => {
  app.addHook('onRequest', privateResponse);
  // Let Fastify enforce the byte limit, but do not parse JSON until the
  // signature has been checked over exactly the bytes received.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.get('/whatsapp/webhook', async (request, reply) => {
    const query = new URLSearchParams(
      (request.raw.url ?? '').split('?')[1] ?? '',
    );
    return reply
      .type('text/plain; charset=utf-8')
      .send(webhook.handleGet(query));
  });

  app.post(
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
};
