import { createFileRoute } from '@tanstack/react-router'
import { DriverForm } from '@/components/driver-form'
import { PageError } from '@/components/page-error'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getDriver } from '@/lib/fleet'
export const Route = createFileRoute('/admin/drivers/$driverId')({
  validateSearch: (
    s: Record<string, unknown>,
  ): { created?: boolean; verificationPending?: boolean } =>
    s.created === true || s.created === 'true'
      ? {
          created: true,
          ...(s.verificationPending === true || s.verificationPending === 'true'
            ? { verificationPending: true }
            : {}),
        }
      : {},
  loader: async ({ params }) => {
    const result = await getDriver({ data: params.driverId })
    return { result }
  },
  staleTime: 0,
  gcTime: 0,
  component: Page,
})
function Page() {
  const data = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const { created, verificationPending } = Route.useSearch()
  if (!data.result.data) return <PageError message={data.result.error!} />
  return (
    <>
      {created && (
        <Alert role="status">
          <AlertDescription>
            {verificationPending
              ? 'Driver created. Email verification pending.'
              : 'Driver created.'}
          </AlertDescription>
        </Alert>
      )}
      <DriverForm
        key={data.result.data.id}
        driver={data.result.data}
        session={session}
      />
    </>
  )
}
