import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { TruckForm } from '@/components/truck-form'
import { BackLink, PageHeader } from '@/components/page-header'
import { PageError } from '@/components/page-error'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { adminOperationsKey } from '@/lib/admin-queries'
import { can } from '@/lib/auth'
import { getTruck } from '@/lib/fleet'
import {
  currentOperationalMonth,
  formatZar,
  getMonthlyEarnings,
} from '@/lib/transport'

export const Route = createFileRoute('/admin/trucks/$truckId')({
  validateSearch: (s: Record<string, unknown>): { created?: boolean } =>
    s.created === true || s.created === 'true' ? { created: true } : {},
  loader: async ({ params, context }) => {
    const result = await getTruck({ data: params.truckId })
    if (result.data?.id && can(context.session, 'revenue.read')) {
      const month = currentOperationalMonth()
      await Promise.allSettled([
        context.queryClient.ensureQueryData({
          queryKey: [
            ...adminOperationsKey(context.session.user.id),
            'truck-monthly-summary',
            result.data.id,
            month,
          ],
          queryFn: () => getMonthlyEarnings(month, result.data!.id),
        }),
      ])
    }
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
  const month = currentOperationalMonth()
  const canSeeRevenue = can(session, 'revenue.read')
  const earningsQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      'truck-monthly-summary',
      data.result.data?.id,
      month,
    ],
    queryFn: () => getMonthlyEarnings(month, data.result.data!.id),
    enabled: canSeeRevenue && Boolean(data.result.data?.id),
  })
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
  const summary = earningsQuery.data?.totals[0]
  return (
    <>
      {created && (
        <Alert role="status">
          <AlertDescription>Vehicle added.</AlertDescription>
        </Alert>
      )}
      {canSeeRevenue && (
        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">
              This month’s operations ({month})
            </CardTitle>
            <div className="flex gap-3 text-xs">
              <Link to="/admin/activities" className="underline underline-offset-4">
                Driver activity
              </Link>
              <Link to="/admin/earnings" className="underline underline-offset-4">
                Earnings
              </Link>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-xs @lg:grid-cols-3 @4xl:grid-cols-6">
            <div>
              <p className="text-muted-foreground">Deliveries</p>
              <p className="text-base font-semibold">{summary?.deliveries ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tonnes</p>
              <p className="text-base font-semibold">
                {summary ? Number(summary.tonnesDelivered).toLocaleString('en-ZA') : '0'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">km driven</p>
              <p className="text-base font-semibold">
                {summary ? Number(summary.kmDriven).toLocaleString('en-ZA') : '0'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Est. revenue</p>
              <p className="text-base font-semibold">
                {formatZar(summary?.revenue ?? '0')}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Fuel & repairs</p>
              <p className="text-base font-semibold">
                {formatZar(
                  Number(summary?.fuelSpend ?? 0) +
                    Number(summary?.repairSpend ?? 0),
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Est. margin</p>
              <p className="text-base font-semibold">
                {formatZar(summary?.estimatedNetMargin ?? '0')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      <TruckForm
        key={data.result.data.id}
        truck={data.result.data}
        session={session}
      />
    </>
  )
}
