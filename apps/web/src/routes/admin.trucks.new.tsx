import { createFileRoute } from '@tanstack/react-router'
import { TruckForm } from '@/components/truck-form'
import { PageError } from '@/components/page-error'
import { can } from '@/lib/auth'
import { deniedPage } from '@/lib/users'

export const Route = createFileRoute('/admin/trucks/new')({
  loader: async ({ context }) => {
    if (
      !can(context.session, 'trucks.write') ||
      !can(context.session, 'trucks.read')
    )
      return { ...(await deniedPage()) }
    return { denied: false }
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
  return <TruckForm session={session} />
}
