import { useState, type FormEvent } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  FleetField,
  FieldGroup,
  driverGroups,
  readFields,
} from './fleet-fields'
import { can, type AdminSession } from '@/lib/auth'
import {
  displayDate,
  expired,
  getDriverOptions,
  saveFleet,
  searchDefaults,
  type Driver,
} from '@/lib/fleet'

type Option = {
  id: string
  firstName?: string
  lastName?: string
  email?: string
  identifier?: string
  registration?: string
}
export function DriverForm({
  driver,
  session,
  users: initialUsers = [],
  trucks: initialTrucks = [],
}: {
  driver?: Driver
  session: AdminSession
  users?: Option[]
  trucks?: Option[]
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('')
  const [mode, setMode] = useState<'existing' | 'new'>('existing'),
    [users, setUsers] = useState(initialUsers),
    [trucks, setTrucks] = useState(initialTrucks)
  const [userQuery, setUserQuery] = useState(''),
    [truckQuery, setTruckQuery] = useState(''),
    [selectedUser, setSelectedUser] = useState<Option | null>(null)
  const [truckId, setTruckId] = useState(driver?.currentTruckId ?? ''),
    [driverStatus, setDriverStatus] = useState(driver?.status ?? 'active')
  const [searching, setSearching] = useState('')
  const router = useRouter(),
    writable = can(session, 'drivers.write')
  const values: Record<string, unknown> = {
    licenceCountry: 'ZA',
    status: 'active',
    ...driver,
  }
  const selectedTruck =
    trucks.find((t) => t.id === truckId) ??
    (driver?.currentTruck?.id === truckId ? driver.currentTruck : null)
  async function search(kind: 'users' | 'trucks') {
    setSearching(kind)
    setError('')
    try {
      const result = await getDriverOptions({
        data: {
          kind,
          q: kind === 'users' ? userQuery : truckQuery,
          driverId: driver?.id,
        },
      })
      if (!result.data) throw new Error(result.error!)
      if (kind === 'users') setUsers(result.data)
      else setTrucks(result.data)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load choices.',
      )
    } finally {
      setSearching('')
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const data = new FormData(e.currentTarget)
    if (
      !driver &&
      mode === 'new' &&
      data.get('password') !== data.get('confirmation')
    ) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const input = {
        ...readFields(data, driverGroups),
        status: driverStatus,
        currentTruckId: truckId || null,
        notes: data.get('notes') || null,
        ...(!driver
          ? mode === 'new'
            ? {
                account: {
                  firstName: data.get('firstName'),
                  lastName: data.get('lastName'),
                  email: data.get('email'),
                  password: data.get('password'),
                },
              }
            : { userId: selectedUser?.id }
          : {}),
      }
      const result = await saveFleet(
        'drivers',
        input,
        session.csrfToken,
        driver?.id,
      )
      if (!driver)
        await router.navigate({
          to: '/admin/drivers/$driverId',
          params: { driverId: result.id },
          search: {
            created: true,
            verificationPending: mode === 'new' ? true : undefined,
          },
        })
      else {
        await router.navigate({
          to: '/admin/drivers/$driverId',
          params: { driverId: driver.id },
          search: {},
          replace: true,
        })
        await router.invalidate()
        setSaved('Driver saved.')
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save driver.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground uppercase">
            People & access
          </p>
          <h1>{driver ? 'Driver profile' : 'Add a driver'}</h1>
          <p className="text-xs text-muted-foreground">
            {driver
              ? `${driver.user.firstName} ${driver.user.lastName} · ${driver.identifier}`
              : 'Personal details, licence and truck assignment'}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/drivers" search={searchDefaults}>
            Back to drivers
          </Link>
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert role="status">
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <fieldset disabled={busy || !writable} className="min-w-0 space-y-4">
            {!driver && (
              <Card className="gap-5 rounded-xl p-6 shadow-none">
                <h2 className="text-sm font-semibold">User account</h2>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      className="accent-black"
                      name="accountMode"
                      value="existing"
                      checked={mode === 'existing'}
                      onChange={() => setMode('existing')}
                    />
                    Existing user
                  </label>
                  {can(session, 'users.create') && (
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        className="accent-black"
                        name="accountMode"
                        value="new"
                        checked={mode === 'new'}
                        onChange={() => setMode('new')}
                      />
                      New account
                    </label>
                  )}
                </div>
                {mode === 'existing' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label="Search users"
                        placeholder="Search name or email"
                        value={userQuery}
                        maxLength={200}
                        onChange={(e) => setUserQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void search('users')
                          }
                        }}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!!searching}
                        onClick={() => void search('users')}
                      >
                        {searching === 'users' ? 'Searching…' : 'Find user'}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="userId" className="text-xs">
                        User *
                      </Label>
                      <select
                        id="userId"
                        name="userId"
                        value={selectedUser?.id ?? ''}
                        required
                        onChange={(e) =>
                          setSelectedUser(
                            users.find((u) => u.id === e.target.value) ?? null,
                          )
                        }
                        className="h-12 w-full rounded-md border bg-muted px-3 text-sm"
                      >
                        <option value="">Select a user</option>
                        {selectedUser &&
                          !users.some((u) => u.id === selectedUser.id) && (
                            <option value={selectedUser.id}>
                              {selectedUser.firstName} {selectedUser.lastName} ·{' '}
                              {selectedUser.email}
                            </option>
                          )}
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.firstName} {u.lastName} · {u.email}
                          </option>
                        ))}
                      </select>
                      {!users.length && (
                        <p className="text-xs text-muted-foreground">
                          No eligible users found
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2">
                    {[
                      {
                        name: 'firstName',
                        label: 'First name',
                        maxLength: 100,
                        required: true,
                      },
                      {
                        name: 'lastName',
                        label: 'Last name',
                        maxLength: 100,
                        required: true,
                      },
                      {
                        name: 'email',
                        label: 'Email address',
                        type: 'email',
                        maxLength: 320,
                        required: true,
                      },
                      {
                        name: 'password',
                        label: 'Password',
                        type: 'password',
                        maxLength: 128,
                        required: true,
                        hint: 'At least 8 characters',
                      },
                      {
                        name: 'confirmation',
                        label: 'Confirm password',
                        type: 'password',
                        maxLength: 128,
                        required: true,
                      },
                    ].map((f) => (
                      <FleetField
                        key={f.name}
                        definition={f}
                        minLength={f.type === 'password' ? 8 : undefined}
                        autoComplete={
                          f.type === 'password'
                            ? 'new-password'
                            : f.name === 'email'
                              ? 'email'
                              : f.name === 'firstName'
                                ? 'given-name'
                                : 'family-name'
                        }
                      />
                    ))}
                  </div>
                )}
              </Card>
            )}
            {driverGroups.map((g) => (
              <FieldGroup key={g.title} title={g.title}>
                {g.fields.map((f) =>
                  f.name === 'status' ? (
                    <FleetField
                      key={f.name}
                      definition={f}
                      value={driverStatus}
                      onChange={(e) => {
                        setDriverStatus(e.target.value)
                        if (e.target.value === 'inactive') setTruckId('')
                      }}
                    />
                  ) : (
                    <FleetField
                      key={f.name}
                      definition={f}
                      value={values[f.name] as string | null}
                    />
                  ),
                )}
              </FieldGroup>
            ))}
            <Card className="gap-4 rounded-xl p-6 shadow-none">
              <h2 className="text-sm font-semibold">Truck assignment</h2>
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="Search available trucks"
                  placeholder="Search identifier or registration"
                  value={truckQuery}
                  maxLength={200}
                  onChange={(e) => setTruckQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void search('trucks')
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!searching}
                  onClick={() => void search('trucks')}
                >
                  {searching === 'trucks' ? 'Searching…' : 'Find truck'}
                </Button>
              </div>
              <Label htmlFor="currentTruckId" className="text-xs">
                Current truck
              </Label>
              <select
                id="currentTruckId"
                name="currentTruckId"
                value={truckId}
                disabled={driverStatus === 'inactive' || !writable}
                onChange={(e) => setTruckId(e.target.value)}
                className="h-12 w-full rounded-md border bg-muted px-3 text-sm disabled:opacity-60"
              >
                <option value="">Unassigned</option>
                {selectedTruck &&
                  !trucks.some((t) => t.id === selectedTruck.id) && (
                    <option value={selectedTruck.id}>
                      {selectedTruck.identifier} · {selectedTruck.registration}
                    </option>
                  )}
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.identifier} · {t.registration}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                A current licence and PrDP are required for assignment.
              </p>
            </Card>
            <Card className="gap-2 rounded-xl p-6 shadow-none">
              <Label htmlFor="notes" className="text-xs">
                Notes
              </Label>
              <textarea
                id="notes"
                name="notes"
                maxLength={2000}
                defaultValue={driver?.notes ?? ''}
                className="min-h-24 rounded-md border bg-muted p-3 text-sm"
              />
            </Card>
          </fieldset>
          <aside className="space-y-4">
            <Card className="gap-4 rounded-xl p-5 shadow-none">
              <h2 className="flex items-center gap-3 text-sm font-semibold">
                <img src="/design/users.svg" alt="" width={24} height={24} />
                {driver ? 'User account' : 'Driver profile'}
              </h2>
              {driver ? (
                <>
                  <p className="break-all text-xs text-muted-foreground">
                    {driver.user.email}
                  </p>
                  <p className="text-xs">
                    Account {driver.user.isActive ? 'active' : 'inactive'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Driver app access:{' '}
                    {driver.driverAccess ? 'Enabled' : 'Not enabled'}
                  </p>
                  {can(session, 'users.read') && (
                    <Button asChild variant="outline">
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: driver.userId }}
                      >
                        Manage account access
                      </Link>
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {selectedUser
                    ? `${selectedUser.firstName} ${selectedUser.lastName}`
                    : mode === 'new'
                      ? 'New account'
                      : 'No user selected'}
                </p>
              )}
            </Card>
            {driver && (
              <Card className="gap-3 rounded-xl p-5 shadow-none">
                <h2 className="text-sm font-semibold">Licence & PrDP</h2>
                <p
                  className={`text-xs ${expired(driver.licenceExpiresOn) ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  Licence: {driver.licenceExpiresOn}
                  {expired(driver.licenceExpiresOn) ? ' · Expired' : ''}
                </p>
                <p
                  className={`text-xs ${expired(driver.prdpExpiresOn) ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  PrDP: {driver.prdpExpiresOn ?? 'Not recorded'}
                  {expired(driver.prdpExpiresOn) ? ' · Expired' : ''}
                </p>
              </Card>
            )}
          </aside>
        </div>
        <div className="flex flex-wrap gap-4 border-t pt-3">
          {writable && (
            <Button
              type="submit"
              disabled={busy}
              className="w-full sm:w-[264px]"
            >
              {busy ? 'Saving…' : driver ? 'Save profile' : 'Create driver'}
            </Button>
          )}
          <Button asChild variant="outline" className="w-full sm:w-[264px]">
            <Link to="/admin/drivers" search={searchDefaults}>
              Cancel
            </Link>
          </Button>
        </div>
      </form>
      {driver && (
        <Card className="gap-4 rounded-xl p-6 shadow-none">
          <h2 className="text-sm font-semibold">Truck assignment history</h2>
          {driver.assignments?.length ? (
            <ul className="divide-y">
              {driver.assignments.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap justify-between gap-2 py-3 text-xs"
                >
                  <span>
                    {h.truck.identifier} · {h.truck.registration}
                  </span>
                  <span className="text-muted-foreground">
                    {displayDate(h.startedAt)} – {displayDate(h.endedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No truck assignments yet
            </p>
          )}
        </Card>
      )}
    </>
  )
}
