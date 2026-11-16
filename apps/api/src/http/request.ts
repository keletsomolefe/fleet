import type { FastifyReply, FastifyRequest } from 'fastify';
import { BadRequestError } from './errors.js';

export const privateResponse = async (
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  reply.header('Cache-Control', 'private, no-store');
};

export function header(
  request: Pick<FastifyRequest, 'headers'>,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

// Accept the UUID versions supported by the API's route parameters.
export function uuidParam(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  ) {
    throw new BadRequestError('Validation failed (uuid is expected)');
  }
  return value;
}
