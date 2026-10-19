import { createFileRoute, notFound } from '@tanstack/react-router'
import { navigation } from '@/components/admin-shell'
import { EmptyPage } from '@/components/empty-page'
import { PageError } from '@/components/page-error'
import { can } from '@/lib/auth'
import { deniedPage } from '@/lib/users'

export const Route = createFileRoute('/admin/$section')({
  loader: async ({ params, context }) => {
    const group = navigation.find((g) =>
      g.items.some((i) => i.section === params.section),
    )
    const item = group?.items.find((i) => i.section === params.section)
    if (!item) throw notFound()
    const denied = !can(context.session, item.permission)
    if (denied) await deniedPage()
    return { title: item.title, group: group!.label, denied }
  },
  component: Section,
})
function Section() {
  const data = Route.useLoaderData()
  if (data.denied)
    return <PageError message="You do not have access to this page." />
  return <EmptyPage {...data} />
}
