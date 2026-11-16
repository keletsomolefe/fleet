import { useForm, useStore } from '@tanstack/react-form'
import { submitForm, textFieldProps } from '@/lib/form'
import { BackLink, PageHeader } from '@/components/page-header'
import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import {
  FleetField,
  FieldGroup,
  truckGroups,
  fieldDefaults,
  readFields,
} from './fleet-fields'
import { can, type AdminSession } from '@/lib/auth'
import { displayDate, expired, saveFleet, type Truck } from '@/lib/fleet'
import { searchDefaults } from '@/lib/fleet'

export function TruckForm({
  truck,
  session,
}: {
  truck?: Truck
  session: AdminSession
}) {
  const [error, setError] = useState(''),
    [saved, setSaved] = useState('')
  const router = useRouter()
  const writable = can(session, 'trucks.write')
  const form = useForm({
    defaultValues: {
      details: fieldDefaults(
        {
          registrationCountry: 'ZA',
          category: 'rigid',
          fuelType: 'diesel',
          status: 'active',
          odometerKm: 0,
          ...truck,
        },
        truckGroups,
      ),
      notes: truck?.notes ?? '',
    },
    onSubmit: async ({ value }) => {
      if (!writable) return
      setError('')
      setSaved('')
      try {
        const result = await saveFleet(
          'trucks',
          {
            ...readFields(value.details, truckGroups),
            deviceIdentifier: truck?.device?.identifier ?? null,
            deviceSerialNumber: truck?.device?.serialNumber ?? null,
            notes: value.notes || null,
          },
          session.csrfToken,
          truck?.id,
        )
        if (!truck)
          await router.navigate({
            to: '/admin/trucks/$truckId',
            params: { truckId: result.id },
            search: { created: true },
          })
        else {
          await router.navigate({
            to: '/admin/trucks/$truckId',
            params: { truckId: truck.id },
            search: {},
            replace: true,
          })
          await router.invalidate()
          setSaved('Vehicle saved.')
        }
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Could not save truck.',
        )
      }
    },
  })
  const busy = useStore(form.store, (state) => state.isSubmitting)
  return (
    <>
      <PageHeader
        back={<BackLink to="/admin/trucks">Vehicles</BackLink>}
        title={truck ? truck.registration : 'Add vehicle'}
        description={
          truck
            ? `${truck.identifier} · ${truck.make} ${truck.model}`
            : undefined
        }
      />
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
      <form onSubmit={submitForm(form)} className="space-y-4">
        <div
          className={`grid items-start gap-4 ${truck ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : 'max-w-3xl'}`}
        >
          {truck && (
            <aside className="min-w-0 space-y-4 xl:col-start-2 xl:row-start-1">
              <Card className="gap-4 rounded-xl p-5 shadow-none">
                <h2 className="text-sm font-semibold">Driving now</h2>
                <p className="text-xs text-muted-foreground">
                  {truck.currentDriving?.driverName ?? 'No active driver'}
                </p>
              </Card>
              {truck && (
                <Card className="gap-4 rounded-xl p-5 shadow-none">
                  <h2 className="text-sm font-semibold">Assigned driver</h2>
                  {truck.driver ? (
                    <Link
                      to="/admin/drivers/$driverId"
                      params={{ driverId: truck.driver.id }}
                      className="text-sm underline [overflow-wrap:anywhere]"
                    >
                      {truck.driver.name} · {truck.driver.identifier}
                    </Link>
                  ) : (
                    <p className="text-xs text-muted-foreground">Unassigned</p>
                  )}
                </Card>
              )}
              {truck && (
                <Card className="gap-3 rounded-xl p-5 shadow-none">
                  <h2 className="text-sm font-semibold">Compliance</h2>
                  {[
                    ['Licence disc', truck.licenceDiscExpiresOn],
                    ['Roadworthy', truck.roadworthyExpiresOn],
                    ['Insurance', truck.insuranceExpiresOn],
                  ].map(([label, date]) => (
                    <p
                      key={label}
                      className={`text-xs ${expired(date!) ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {label}: {date || 'Not recorded'}
                      {expired(date!) ? ' · Expired' : ''}
                    </p>
                  ))}
                  {truck.nextServiceDueKm !== null && (
                    <p className="text-xs text-muted-foreground">
                      {truck.odometerKm >= truck.nextServiceDueKm
                        ? 'Service due'
                        : 'Next service'}
                      : {truck.nextServiceDueKm.toLocaleString()} km
                    </p>
                  )}
                </Card>
              )}
            </aside>
          )}
          <fieldset
            disabled={busy || !writable}
            className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1"
          >
            {truckGroups
              .filter((g) => g.title !== 'Truck device')
              .map((g) => (
                <FieldGroup key={g.title} title={g.title}>
                  {g.fields.map((f) => (
                    <form.Field key={f.name} name={`details.${f.name}`}>
                      {(field) => (
                        <FleetField
                          definition={f}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.currentTarget.value)
                          }
                        />
                      )}
                    </form.Field>
                  ))}
                </FieldGroup>
              ))}
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
              {busy ? 'Saving…' : truck ? 'Save vehicle' : 'Add vehicle'}
            </Button>
          )}
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/admin/trucks" search={searchDefaults}>
              {writable ? 'Cancel' : 'Back to vehicles'}
            </Link>
          </Button>
        </div>
      </form>
      {truck && (
        <Card className="gap-4 rounded-xl p-4 sm:p-6 shadow-none">
          <h2 className="text-sm font-semibold">Previous device history</h2>
          {truck.deviceHistory?.length ? (
            <ul className="divide-y">
              {truck.deviceHistory.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap justify-between gap-2 py-3 text-xs"
                >
                  <span>{h.device.identifier}</span>
                  <span className="text-muted-foreground">
                    {displayDate(h.startedAt)} – {displayDate(h.endedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No device bindings yet
            </p>
          )}
        </Card>
      )}
    </>
  )
}
