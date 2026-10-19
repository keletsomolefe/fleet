import { createServerFn } from '@tanstack/react-start'
import {
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
} from '@tanstack/react-start/server'

export interface Truck {
  id: string
  identifier: string
  registration: string
  registrationCountry: string
  make: string
  model: string
  year: number | null
  vin: string | null
  engineNumber: string | null
  category: string
  fuelType: string
  transmission: string | null
  axleCount: number | null
  grossVehicleMassKg: number | null
  tareKg: number | null
  payloadCapacityKg: number | null
  odometerKm: number
  tankCapacityLitres: number | null
  licenceDiscExpiresOn: string | null
  roadworthyExpiresOn: string | null
  insuranceProvider: string | null
  insurancePolicyNumber: string | null
  insuranceExpiresOn: string | null
  serviceIntervalKm: number | null
  nextServiceDueKm: number | null
  status: string
  notes: string | null
  device: { identifier: string; serialNumber: string | null } | null
  driver?: { id: string; identifier: string; name: string } | null
  deviceHistory?: Array<{
    id: string
    device: { identifier: string }
    startedAt: string
    endedAt: string | null
  }>
}
export interface Driver {
  driverAccess?: boolean
  id: string
  userId: string
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
    isActive: boolean
  }
  identifier: string
  phone: string
  licenceNumber: string
  licenceCode: string
  licenceCountry: string
  licenceExpiresOn: string
  prdpNumber: string | null
  prdpExpiresOn: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  status: string
  currentTruckId: string | null
  currentTruck: Truck | null
  notes: string | null
  assignments?: Array<{
    id: string
    truck: Truck
    startedAt: string
    endedAt: string | null
  }>
}
export interface FleetList<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export type FleetKind = 'drivers' | 'trucks'
export type Search = { q: string; page: number; status: string }
export const searchDefaults: Search = { q: '', page: 1, status: '' }
export function validateSearch(s: Record<string, unknown>): Search {
  return {
    q: typeof s.q === 'string' ? s.q.slice(0, 200) : '',
    page:
      Number.isInteger(Number(s.page)) &&
      Number(s.page) > 0 &&
      Number(s.page) <= 999999
        ? Number(s.page)
        : 1,
    status: ['active', 'inactive', 'maintenance'].includes(String(s.status))
      ? String(s.status)
      : '',
  }
}
async function read<T>(
  path: string,
): Promise<{ data: T | null; error: string | null }> {
  setResponseHeader('Cache-Control', 'private, no-store')
  try {
    const r = await fetch(new URL(`api/admin/${path}`, process.env.APP_URL), {
      headers: { Cookie: getRequestHeader('cookie') ?? '' },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) {
      setResponseStatus(r.status)
      return {
        data: null,
        error:
          r.status === 403
            ? 'You do not have access to this page.'
            : r.status === 404
              ? 'Record not found.'
              : 'Could not load this page. Please try again.',
      }
    }
    return { data: (await r.json()) as T, error: null }
  } catch {
    setResponseStatus(503)
    return { data: null, error: 'Could not load this page. Please try again.' }
  }
}
function listInput(data: Search) {
  return validateSearch(data)
}
function idInput(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid record.')
  return id
}
export const getTrucks = createServerFn({ method: 'GET' })
  .validator(listInput)
  .handler(({ data }) =>
    read<FleetList<Truck>>(
      `trucks?${new URLSearchParams({ ...data, page: String(data.page) })}`,
    ),
  )
export const getDrivers = createServerFn({ method: 'GET' })
  .validator(listInput)
  .handler(({ data }) =>
    read<FleetList<Driver>>(
      `drivers?${new URLSearchParams({ ...data, page: String(data.page) })}`,
    ),
  )
export const getTruck = createServerFn({ method: 'GET' })
  .validator(idInput)
  .handler(({ data }) => read<Truck>(`trucks/${data}`))
export const getDriver = createServerFn({ method: 'GET' })
  .validator(idInput)
  .handler(({ data }) => read<Driver>(`drivers/${data}`))
export const getDriverOptions = createServerFn({ method: 'GET' })
  .validator(
    (data: { q?: string; driverId?: string; kind: 'users' | 'trucks' }) => {
      if (
        !['users', 'trucks'].includes(data.kind) ||
        (data.q && data.q.length > 200)
      )
        throw new Error('Invalid search.')
      if (data.driverId) idInput(data.driverId)
      return data
    },
  )
  .handler(({ data }) =>
    read<
      Array<{
        id: string
        firstName?: string
        lastName?: string
        email?: string
        identifier?: string
        registration?: string
      }>
    >(
      `drivers/${data.kind}?${new URLSearchParams({ q: data.q ?? '', ...(data.driverId ? { driverId: data.driverId } : {}) })}`,
    ),
  )
export async function saveFleet(
  kind: FleetKind,
  input: Record<string, unknown>,
  csrfToken: string,
  id?: string,
) {
  const r = await fetch(
    `/api/admin/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`,
    {
      method: id ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(input),
    },
  )
  if (r.status === 401) {
    window.location.assign('/login')
    throw new Error('Please sign in.')
  }
  const body = await r.json()
  if (!r.ok)
    throw new Error(
      typeof body.message === 'string'
        ? body.message
        : 'Could not save. Please try again.',
    )
  return body as Driver | Truck
}
export const displayDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Johannesburg',
      }).format(new Date(value))
    : 'Current'
export function expired(value: string | null) {
  return (
    !!value &&
    value <
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Johannesburg',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
  )
}
