import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AdminShell } from '@/components/admin-shell'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const result = await getSession()
    if (!result.session)
      throw redirect({
        to: '/login',
        search: {
          flow: undefined,
          reason:
            result.status === 403
              ? 'access-denied'
              : result.status === 401
                ? undefined
                : 'unavailable',
        },
      })
    return { session: result.session }
  },
  component: Admin,
})
function Admin() {
  return (
    <AdminShell session={Route.useRouteContext().session}>
      <Outlet />
    </AdminShell>
  )
}
