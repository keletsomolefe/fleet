import { useForm, useStore } from '@tanstack/react-form'
import { submitForm, textFieldProps } from '@/lib/form'
import { BackLink, PageHeader } from '@/components/page-header'
import { useCallback, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  FleetField,
  FieldGroup,
  driverGroups,
  fieldDefaults,
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

export function DriverForm({
  driver,
  session,
}: {
  driver?: Driver
  session: AdminSession
}) {
  const [error, setError] = useState(''),
    [saved, setSaved] = useState('')
  const router = useRouter(),
    writable = can(session, 'drivers.write')
  const loadUsers = useCallback(
    async (query: string, signal: AbortSignal) => {
      const result = await getDriverOptions({
        signal,
        data: { kind: 'users', q: query, driverId: driver?.id },
      })
      if (!result.data) throw new Error(result.error ?? 'Could not load users.')
      return result.data.map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName} · ${user.email}`,
      }))
    },
    [driver?.id],
  )
  const loadTrucks = useCallback(
    async (query: string, signal: AbortSignal) => {
      const result = await getDriverOptions({
        signal,
        data: { kind: 'trucks', q: query, driverId: driver?.id },
      })
      if (!result.data)
        throw new Error(result.error ?? 'Could not load vehicles.')
      return result.data.map((truck) => ({
        value: truck.id,
        label: `${truck.registration} · ${truck.identifier}`,
      }))
    },
    [driver?.id],
  )
  const form = useForm({
    defaultValues: {
      mode: 'existing' as 'existing' | 'new',
      user: null as ComboboxOption | null,
      truck: driver?.currentTruck
        ? {
            value: driver.currentTruck.id,
            label: `${driver.currentTruck.registration} · ${driver.currentTruck.identifier}`,
          }
        : (null as ComboboxOption | null),
      details: fieldDefaults(
        { licenceCountry: 'ZA', status: 'active', ...driver },
        driverGroups,
      ),
      account: {
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        confirmation: '',
      } as Record<string, string>,
      notes: driver?.notes ?? '',
    },
    validators: {
      onSubmit: ({ value }) =>
        !driver &&
        value.mode === 'new' &&
        value.account.password !== value.account.confirmation
          ? 'Passwords do not match.'
          : undefined,
    },
    onSubmit: async ({ value }) => {
      if (!writable) return
      const { mode, user, truck, details, account, notes } = value
      if (
        !driver &&
        (mode === 'existing' ? !user : !can(session, 'users.create'))
      )
        return
      setError('')
      setSaved('')
      try {
        const input = {
          ...readFields(details, driverGroups),
          currentTruckId: truck?.value ?? null,
          notes: notes || null,
          ...(!driver
            ? mode === 'new'
              ? {
                  account: {
                    firstName: account.firstName,
                    lastName: account.lastName,
                    email: account.email,
                    password: account.password,
                  },
                }
              : { userId: user?.value }
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
      }
    },
  })
  const mode = useStore(form.store, (state) => state.values.mode)
  const driverStatus = useStore(
    form.store,
    (state) => state.values.details.status,
  )
  const busy = useStore(form.store, (state) => state.isSubmitting)
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  )
  return (
    <>
      <PageHeader
        back={<BackLink to="/admin/drivers">Drivers</BackLink>}
        title={
          driver
            ? `${driver.user.firstName} ${driver.user.lastName}`
            : 'Add a driver'
        }
        description={driver?.identifier}
      />
      {(validationError || error) && (
        <Alert variant="destructive">
          <AlertDescription>{validationError || error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert role="status">
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submitForm(form)} className="space-y-4">
        <div
          className={`grid items-start gap-4 ${driver ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : 'max-w-3xl'}`}
        >
          {driver && (
            <aside className="min-w-0 space-y-4 xl:col-start-2 xl:row-start-1">
              <Card className="gap-4 rounded-xl p-5 shadow-none">
                <h2 className="flex items-center gap-3 text-sm font-semibold">
                  <img src="/design/users.svg" alt="" width={24} height={24} />
                  User account
                </h2>
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
          )}
          <fieldset
            disabled={busy || !writable}
            className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1"
          >
            {!driver && (
              <Card className="gap-5 rounded-xl p-4 sm:p-6 shadow-none">
                <h2 className="text-sm font-semibold">User account</h2>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      className="accent-black"
                      name="accountMode"
                      value="existing"
                      checked={mode === 'existing'}
                      onChange={() => {
                        form.setFieldValue('mode', 'existing')
                        form.resetField('account')
                      }}
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
                        onChange={() => form.setFieldValue('mode', 'new')}
                      />
                      New account
                    </label>
                  )}
                </div>
                {mode === 'existing' ? (
                  <div className="space-y-2">
                    <Label htmlFor="userId" className="text-xs">
                      User *
                    </Label>
                    <form.Field name="user">
                      {(field) => (
                        <Combobox
                          id="userId"
                          name="userId"
                          value={field.state.value}
                          onValueChange={field.handleChange}
                          optionsKey={[
                            'admin',
                            session.user.id,
                            'driver-users',
                          ]}
                          loadOptions={loadUsers}
                          placeholder="Search name or email"
                          emptyMessage="No users found."
                          disabled={busy || !writable}
                          required
                        />
                      )}
                    </form.Field>
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
                      <form.Field key={f.name} name={`account.${f.name}`}>
                        {(field) => (
                          <FleetField
                            definition={f}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              field.handleChange(event.currentTarget.value)
                            }
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
                        )}
                      </form.Field>
                    ))}
                  </div>
                )}
              </Card>
            )}
            {driverGroups.map((g) => (
              <FieldGroup key={g.title} title={g.title}>
                {g.fields.map((f) => (
                  <form.Field key={f.name} name={`details.${f.name}`}>
                    {(field) => (
                      <FleetField
                        definition={f}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          const value = event.currentTarget.value
                          field.handleChange(value)
                          if (f.name === 'status' && value === 'inactive')
                            form.setFieldValue('truck', null)
                        }}
                      />
                    )}
                  </form.Field>
                ))}
              </FieldGroup>
            ))}
            <Card className="gap-4 rounded-xl p-4 sm:p-6 shadow-none">
              <h2 className="text-sm font-semibold">Vehicle assignment</h2>
              <Label htmlFor="currentTruckId" className="text-xs">
                Assigned vehicle
              </Label>
              <form.Field name="truck">
                {(field) => (
                  <Combobox
                    id="currentTruckId"
                    name="currentTruckId"
                    value={field.state.value}
                    onValueChange={field.handleChange}
                    optionsKey={[
                      'admin',
                      session.user.id,
                      'driver-trucks',
                      driver?.id,
                    ]}
                    loadOptions={loadTrucks}
                    placeholder="Search fleet number or registration"
                    emptyMessage="No vehicles found."
                    disabled={busy || driverStatus === 'inactive' || !writable}
                  />
                )}
              </form.Field>
              <p className="text-[11px] text-muted-foreground">
                A current licence and PrDP are required for assignment.
              </p>
            </Card>
            <Card className="gap-2 rounded-xl p-4 sm:p-6 shadow-none">
              <Label htmlFor="notes" className="text-xs">
                Notes
              </Label>
              <form.Field name="notes">
                {(field) => (
                  <textarea
                    id="notes"
                    {...textFieldProps(field)}
                    maxLength={2000}
                    className="min-h-24 rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                  />
                )}
              </form.Field>
            </Card>
          </fieldset>
        </div>
        <div className="flex flex-wrap gap-4 border-t pt-3">
          {writable && (
            <Button type="submit" disabled={busy} className="w-full sm:w-auto">
              {busy ? 'Saving…' : driver ? 'Save profile' : 'Create driver'}
            </Button>
          )}
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/admin/drivers" search={searchDefaults}>
              {writable ? 'Cancel' : 'Back to drivers'}
            </Link>
          </Button>
        </div>
      </form>
      {driver && (
        <Card className="gap-4 rounded-xl p-4 sm:p-6 shadow-none">
          <h2 className="text-sm font-semibold">Vehicle assignment history</h2>
          {driver.assignments?.length ? (
            <ul className="divide-y">
              {driver.assignments.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap justify-between gap-2 py-3 text-xs"
                >
                  <span>
                    {h.truck.registration} · {h.truck.identifier}
                  </span>
                  <span className="text-muted-foreground">
                    {displayDate(h.startedAt)} – {displayDate(h.endedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No vehicle assignments yet
            </p>
          )}
        </Card>
      )}
    </>
  )
}
