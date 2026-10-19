import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '@/lib/auth'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const result = await getSession()
    throw redirect({ to: result.status === 200 ? '/admin' : '/login' })
  },
})
