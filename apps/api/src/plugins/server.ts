import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { errorResponse, HttpError } from '../shared/errors.js';

function formatValidationError(error: FastifyError): string | undefined {
  const first = error.validation?.[0];
  if (!first) return undefined;
  if (error.validationContext === 'params' && first.keyword === 'pattern') {
    return 'Validation failed (uuid is expected)';
  }
  return first.message;
}

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
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      return reply
        .code(400)
        .send(errorResponse(400, formatValidationError(fastifyError)));
    }
    const status =
      error instanceof Error && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
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
