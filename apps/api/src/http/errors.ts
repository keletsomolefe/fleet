import { STATUS_CODES } from 'node:http';

type ErrorBody = { message: string } & Record<string, unknown>;

export class HttpError extends Error {
  readonly body?: ErrorBody;

  constructor(
    message: string | ErrorBody,
    readonly statusCode: number,
  ) {
    super(typeof message === 'string' ? message : message.message);
    if (typeof message !== 'string') this.body = message;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not Found') {
    super(message, 404);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string | ErrorBody = 'Conflict') {
    super(message, 409);
  }
}

export class GoneError extends HttpError {
  constructor(message = 'Gone') {
    super(message, 410);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service Unavailable') {
    super(message, 503);
  }
}

export function errorResponse(statusCode: number, message?: string) {
  const error = STATUS_CODES[statusCode] ?? 'Request failed';
  return {
    message: message ?? error,
    ...(message && message !== error && statusCode !== 429 && statusCode !== 500
      ? { error }
      : {}),
    statusCode,
  };
}
