import { createFileRoute } from '@tanstack/react-router'
import { DriverForm } from '@/components/driver-form'
import { PageError } from '@/components/page-error'
import { can } from '@/lib/auth'
import { deniedPage } from '@/lib/users'
import { getDriverOptions } from '@/lib/fleet'

export const Route = createFileRoute('/admin/drivers/new')({
  loader: async ({ context }) => {
    if (
      !can(context.session, 'drivers.write') ||
      !can(context.session, 'drivers.read')
    )
      return { ...(await deniedPage()) }
    const [users, trucks] = await Promise.all([
      getDriverOptions({ data: { kind: 'users' } }),
      getDriverOptions({ data: { kind: 'trucks' } }),
    ])
    return { denied: false, users, trucks }
  },
  staleTime: 0,
  gcTime: 0,
  component: Page,
})
function Page() {
  const data = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  if (data.denied)
    return <PageError message="You do not have access to this page." />
  if (!data.users?.data || !data.trucks?.data)
    return (
      <PageError
        message={
          data.users?.error ?? data.trucks?.error ?? 'Could not load choices.'
        }
      />
    )
  return (
    <DriverForm
      session={session}
      users={data.users?.data ?? []}
      trucks={data.trucks?.data ?? []}
    />
  )
}
