import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/signup')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/users/new', replace: true })
  },
})
