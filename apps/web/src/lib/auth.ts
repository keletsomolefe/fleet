import { createServerFn } from '@tanstack/react-start'
import {
  getRequestHeader,
  setResponseHeader,
} from '@tanstack/react-start/server'
import { logoutAuth } from './auth-flow'

export interface AdminUser {
  id: string
  identityId: string
  email: string
  firstName: string
  lastName: string
}
export interface RoleSummary {
  id: string
  key: string
  name: string
}
export interface AdminSession {
  user: AdminUser
  roles: RoleSummary[]
  permissions: string[]
  csrfToken: string
}

export const can = (session: AdminSession, permission: string) =>
  session.permissions.includes(permission)

export const getSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    setResponseHeader('Cache-Control', 'private, no-store')
    try {
      const response = await fetch(
        new URL('api/auth/session', process.env.APP_URL),
        {
          headers: { Cookie: getRequestHeader('cookie') ?? '' },
          signal: AbortSignal.timeout(8_000),
        },
      )
      if (!response.ok) return { status: response.status, session: null }
      return { status: 200, session: (await response.json()) as AdminSession }
    } catch {
      return { status: 503, session: null }
    }
  },
)

export async function logout() {
  if (!(await logoutAuth()).ok)
    throw new Error('Could not sign out. Please try again.')
  window.location.assign('/login')
}
