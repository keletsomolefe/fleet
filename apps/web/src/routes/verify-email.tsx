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
    if (result.flow && deps.flow !== result.flow.id)
      throw redirect({
        to: '/verify-email',
        search: { flow: result.flow.id },
        replace: true,
      })
    return result
  },
  staleTime: 0,
  gcTime: 0,
  component: Verification,
})
function Verification() {
  return <KratosForm kind="verification" initial={Route.useLoaderData()} />
}
