import { createFileRoute } from '@tanstack/react-router'
import { TruckForm } from '@/components/truck-form'
import { BackLink, PageHeader } from '@/components/page-header'
import { PageError } from '@/components/page-error'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getTruck } from '@/lib/fleet'

export const Route = createFileRoute('/admin/trucks/$truckId')({
  validateSearch: (s: Record<string, unknown>): { created?: boolean } =>
    s.created === true || s.created === 'true' ? { created: true } : {},
  loader: async ({ params }) => {
    const result = await getTruck({ data: params.truckId })
    return { result }
  },
  staleTime: 0,
  gcTime: 0,
  component: Page,
})
function Page() {
  const data = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const { created } = Route.useSearch()
  if (!data.result.data)
    return (
      <>
        <PageHeader
          title="Vehicle profile"
          back={<BackLink to="/admin/trucks">Vehicles</BackLink>}
        />
        <PageError message={data.result.error!} />
      </>
    )
  return (
    <>
      {created && (
        <Alert role="status">
          <AlertDescription>Vehicle added.</AlertDescription>
        </Alert>
      )}
      <TruckForm
        key={data.result.data.id}
        truck={data.result.data}
        session={session}
      />
    </>
  )
}
