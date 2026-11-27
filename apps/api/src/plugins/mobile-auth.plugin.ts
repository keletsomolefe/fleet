import type { FastifyRequest } from 'fastify';
import type {
  AdminContext,
  AuthService,
} from '../modules/identity/application/auth.service.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors.js';
import { header } from '../shared/http.js';

declare module 'fastify' {
  interface FastifyRequest {
    mobileContext: AdminContext | null;
    mobileToken: string | null;
  }
}

type NativeHeaders = Pick<FastifyRequest, 'headers'>;

/** Rejects browser-originated requests on native mobile endpoints. */
export function assertNativeRequest(request: NativeHeaders): void {
  // Native Kratos flows must never replace the browser's cookie/CSRF flow.
  if (
    header(request, 'origin') ||
    header(request, 'sec-fetch-site') ||
    header(request, 'cookie')
  ) {
    throw new ForbiddenError('Use the installed Fleet app.');
  }
}

/** Extracts and validates a native Bearer token from a mobile request. */
export function extractBearerToken(request: NativeHeaders): string {
  assertNativeRequest(request);
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{16,1024})$/.exec(
    header(request, 'authorization') ?? '',
  );
  if (!match) throw new UnauthorizedError('Please sign in.');
  return match[1];
}

/** Fastify hook that authenticates native mobile Bearer requests into `request.mobileContext`. */
export function mobileSessionHook(auth: AuthService) {
  return async (request: FastifyRequest) => {
    const token = extractBearerToken(request);
    request.mobileToken = token;
    request.mobileContext = await auth.authenticateNative(token);
  };
}

export function requireMobile(request: FastifyRequest): AdminContext {
  if (!request.mobileContext) throw new UnauthorizedError('Please sign in.');
  return request.mobileContext;
}
