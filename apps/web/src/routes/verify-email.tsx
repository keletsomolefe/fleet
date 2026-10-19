import { createFileRoute, redirect } from '@tanstack/react-router'
import { KratosForm } from '@/components/kratos-form'
import { isFlowId, loadAuthFlow } from '@/lib/auth-flow'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>) => ({
    flow: isFlowId(search.flow) ? search.flow : undefined,
  }),
  loaderDeps: ({ search }) => ({ flow: search.flow }),
  loader: async ({ deps }) => {
    const result = await loadAuthFlow({
      data: { kind: 'verification', flowId: deps.flow },
    })
    if (deps.flow && result.flow)
      throw redirect({
        to: '/verify-email',
        search: { flow: undefined },
        replace: true,
      })
    return result
  },
  staleTime: 0,
  gcTime: 0,
  component: Verification,
})
function Verification() {
  const data = Route.useLoaderData()
  const key =
    data.flow?.ui.nodes.find((node) => node.attributes.name === 'csrf_token')
      ?.attributes.value ?? 'verification'
  return <KratosForm key={key} kind="verification" initial={data} />
}
