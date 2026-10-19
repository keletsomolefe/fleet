import { createServerFn } from '@tanstack/react-start'
import {
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
} from '@tanstack/react-start/server'
import type { AdminUser, RoleSummary } from './auth'

export interface CompanyUser extends AdminUser {
  isActive: boolean
  roles: RoleSummary[]
  lastLoginAt: string | null
  createdAt: string
  permissions?: string[]
}
export interface RoleDefinition extends RoleSummary {
  permissions: Array<{ key: string; name: string }>
}
export interface UserList {
  items: CompanyUser[]
  page: number
  pageSize: number
  total: number
}
export interface Result<T> {
  data: T | null
  error: string | null
}

async function read<T>(path: string): Promise<Result<T>> {
  setResponseHeader('Cache-Control', 'private, no-store')
  try {
    const response = await fetch(
      new URL(`api/admin/${path}`, process.env.APP_URL),
      {
        headers: { Cookie: getRequestHeader('cookie') ?? '' },
        signal: AbortSignal.timeout(8_000),
      },
    )
    if (!response.ok) {
      setResponseStatus(response.status)
      return {
        data: null,
        error:
          response.status === 403
            ? 'You do not have access to this page.'
            : response.status === 404
              ? 'User not found.'
              : 'Could not load this page. Please try again.',
      }
    }
    return { data: (await response.json()) as T, error: null }
  } catch {
    setResponseStatus(503)
    return { data: null, error: 'Could not load this page. Please try again.' }
  }
}

export const getUsers = createServerFn({ method: 'GET' })
  .validator((data: { q: string; page: number }) => {
    if (
      typeof data.q !== 'string' ||
      data.q.length > 200 ||
      !Number.isInteger(data.page) ||
      data.page < 1 ||
      data.page > 999999
    )
      throw new Error('Invalid user search.')
    return data
  })
  .handler(({ data }) =>
    read<UserList>(
      `users?${new URLSearchParams({ q: data.q, page: String(data.page) })}`,
    ),
  )

export const getUser = createServerFn({ method: 'GET' })
  .validator((id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid user.')
    return id
  })
  .handler(({ data }) => read<CompanyUser>(`users/${encodeURIComponent(data)}`))

export const getRoles = createServerFn({ method: 'GET' }).handler(() =>
  read<RoleDefinition[]>('roles'),
)

export const deniedPage = createServerFn({ method: 'GET' }).handler(() => {
  setResponseHeader('Cache-Control', 'private, no-store')
  setResponseStatus(403)
  return { denied: true }
})

export async function updateAccess(
  id: string,
  roleIds: string[],
  isActive: boolean,
  csrfToken: string,
): Promise<CompanyUser> {
  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(id)}/access`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ roleIds, isActive }),
    },
  )
  if (response.status === 401) {
    window.location.assign('/login')
    throw new Error('Please sign in.')
  }
  const body = await response.json()
  if (!response.ok)
    throw new Error(
      typeof body.message === 'string'
        ? body.message
        : 'Could not save access.',
    )
  return body
}
