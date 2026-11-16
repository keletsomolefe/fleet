import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { errorResponse, HttpError } from './errors.js';

export function createHttpServer(options: FastifyServerOptions = {}) {
  const app = Fastify({
    bodyLimit: 100 * 1024,
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    routerOptions: { caseSensitive: false, ignoreTrailingSlash: true },
    ...options,
  });
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body, done) => {
      // Installed mobile clients send this content type even for bodyless requests.
      const json = body.toString();
      if (json === '') done(null, undefined);
      else return parseJson(request, json, done);
    },
  );
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send(error.body ?? errorResponse(error.statusCode, error.message));
    }
    const status =
      error instanceof Error && 'statusCode' in error
        ? error.statusCode
        : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send(errorResponse(status));
    }
    request.log.error({ err: error }, 'Unexpected API error');
    return reply.code(500).send(errorResponse(500, 'Internal server error'));
  });
  app.setNotFoundHandler(sendNotFound);
  return app;
}

export function sendNotFound(request: FastifyRequest, reply: FastifyReply) {
  return reply
    .code(404)
    .send(errorResponse(404, `Cannot ${request.method} ${request.url}`));
}
