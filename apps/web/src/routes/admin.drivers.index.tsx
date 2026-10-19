import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { FleetList } from '@/components/fleet-list'
import { getDrivers, validateSearch, searchDefaults } from '@/lib/fleet'
export const Route = createFileRoute('/admin/drivers/')({
  validateSearch,
  search: { middlewares: [stripSearchParams(searchDefaults)] },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getDrivers({ data: deps }),
  staleTime: 0,
  gcTime: 0,
  component: Page,
})
function Page() {
  return (
    <FleetList
      kind="drivers"
      result={Route.useLoaderData()}
      session={Route.useRouteContext().session}
      search={Route.useSearch()}
    />
  )
}
