import { createServerFn } from '@tanstack/react-start';
import {
  getRequestHeader,
  setResponseHeader,
} from '@tanstack/react-start/server';

const serverAdminGet = createServerFn({ method: 'GET' })
  .validator((path: string) => {
    if (
      typeof path !== 'string' ||
      !path ||
      path.startsWith('/') ||
      path.includes('..')
    ) {
      throw new Error('Invalid API path.');
    }
    return path;
  })
  .handler(async ({ data: path }) => {
    setResponseHeader('Cache-Control', 'private, no-store');
    const response = await fetch(
      new URL(`api/admin/${path}`, process.env.APP_URL),
      {
        headers: { Cookie: getRequestHeader('cookie') ?? '' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        typeof body?.message === 'string'
          ? body.message
          : response.status === 403
            ? 'You do not have access to this action.'
            : 'Could not complete this request. Please try again.',
      );
    }
    return body;
  });

export async function adminGet<T>(path: string): Promise<T> {
  if (typeof window === 'undefined') {
    return (await serverAdminGet({ data: path })) as T;
  }
  const response = await fetch(`/api/admin/${path}`, {
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : response.status === 403
          ? 'You do not have access to this action.'
          : 'Could not complete this request. Please try again.',
    );
  }
  return body as T;
}
