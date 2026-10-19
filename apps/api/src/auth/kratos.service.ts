import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface KratosIdentity {
  id: string;
  state?: string;
  traits: { email: string; name: { first: string; last: string } };
  verifiable_addresses?: Array<{
    value: string;
    verified: boolean;
    via: string;
  }>;
  metadata_admin?: Record<string, unknown>;
}

export interface KratosSession {
  id: string;
  active: boolean;
  authenticated_at: string;
  expires_at?: string;
  identity: KratosIdentity;
}

export class KratosError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
  ) {
    super('Identity service rejected the request.');
  }
}

@Injectable()
export class KratosService {
  async request<T>(
    path: string,
    options: RequestInit = {},
    admin = false,
  ): Promise<T> {
    const base = process.env[admin ? 'KRATOS_ADMIN_URL' : 'KRATOS_PUBLIC_URL'];
    if (!base)
      throw new ServiceUnavailableException(
        'Authentication is not configured.',
      );
    let response: Response;
    try {
      response = await fetch(new URL(path, base), {
        ...options,
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch {
      throw new ServiceUnavailableException(
        'Authentication is temporarily unavailable.',
      );
    }
    const body =
      response.status === 204
        ? undefined
        : await response.json().catch(() => undefined);
    if (response.status >= 500)
      throw new ServiceUnavailableException(
        'Authentication is temporarily unavailable.',
      );
    if (!response.ok) throw new KratosError(response.status, body?.error?.id);
    return body as T;
  }

  whoami(cookie: string) {
    return this.request<KratosSession>('sessions/whoami', {
      headers: { Cookie: cookie },
    });
  }

  whoamiToken(token: string) {
    return this.request<KratosSession>('sessions/whoami', {
      headers: { 'X-Session-Token': token },
    });
  }

  revokeToken(token: string) {
    return this.request<void>('self-service/logout/api', {
      method: 'DELETE',
      body: JSON.stringify({ session_token: token }),
    });
  }

  createIdentity(body: unknown) {
    return this.request<KratosIdentity>(
      'admin/identities',
      { method: 'POST', body: JSON.stringify(body) },
      true,
    );
  }

  deleteIdentity(id: string) {
    return this.request<void>(
      `admin/identities/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      true,
    );
  }
}
