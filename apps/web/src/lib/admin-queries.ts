import type { QueryClient } from '@tanstack/react-query'

export const adminOperationsKey = (userId: string) =>
  ['admin', userId, 'operations'] as const

export const adminNotificationsKey = (userId: string) =>
  ['admin', userId, 'notifications'] as const

export function refreshAdminOperations(client: QueryClient, userId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: adminOperationsKey(userId) }),
    client.invalidateQueries({ queryKey: adminNotificationsKey(userId) }),
  ])
}
