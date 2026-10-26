import { PageHeader } from '@/components/page-header'
import { useState, type FormEvent } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { FleetField, FieldGroup, truckGroups, readFields } from './fleet-fields'
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('')
  const router = useRouter()
  const writable = can(session, 'trucks.write')
  const values: Record<string, unknown> = {
    registrationCountry: 'ZA',
    category: 'rigid',
    fuelType: 'diesel',
    status: 'active',
    odometerKm: 0,
    ...truck,
    deviceIdentifier: truck?.device?.identifier,
    deviceSerialNumber: truck?.device?.serialNumber,
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const data = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const result = await saveFleet(
        'trucks',
        {
          ...readFields(data, truckGroups),
          deviceIdentifier: truck?.device?.identifier ?? null,
          deviceSerialNumber: truck?.device?.serialNumber ?? null,
          notes: data.get('notes') || null,
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
        setSaved('Truck saved.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save truck.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader
        group="Vehicles"
        title={
          truck ? `${truck.identifier} · ${truck.registration}` : 'Add vehicle'
        }
        description={truck ? `${truck.make} ${truck.model}` : 'Vehicle details'}
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/trucks" search={searchDefaults}>
              Back to trucks
            </Link>
          </Button>
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
      <form onSubmit={submit} className="space-y-4">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <fieldset disabled={busy || !writable} className="min-w-0 space-y-4">
            {truckGroups
              .filter((g) => g.title !== 'Truck device')
              .map((g) => (
                <FieldGroup key={g.title} title={g.title}>
                  {g.fields.map((f) => (
                    <FleetField
                      key={f.name}
                      definition={f}
                      value={values[f.name] as string | number | null}
                    />
                  ))}
                </FieldGroup>
              ))}
            <Card className="gap-2 rounded-xl p-6 shadow-none">
              <Label htmlFor="notes" className="text-xs">
                Notes
              </Label>
              <textarea
                id="notes"
                name="notes"
                maxLength={2000}
                defaultValue={truck?.notes ?? ''}
                className="min-h-24 rounded-md border bg-muted p-3 text-sm"
              />
            </Card>
          </fieldset>
          <aside className="space-y-4">
            <Card className="gap-4 rounded-xl p-5 shadow-none">
              <h2 className="text-sm font-semibold">Driving now</h2>
              <p className="text-xs text-muted-foreground">
                {truck?.currentDriving?.driverName ?? 'No active driver'}
              </p>
            </Card>
            {truck && (
              <Card className="gap-4 rounded-xl p-5 shadow-none">
                <h2 className="text-sm font-semibold">Assigned driver</h2>
                {truck.driver ? (
                  <Link
                    to="/admin/drivers/$driverId"
                    params={{ driverId: truck.driver.id }}
                    className="text-xs underline"
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
        </div>
        <div className="flex flex-wrap gap-4 border-t pt-3">
          {writable && (
            <Button
              type="submit"
              disabled={busy}
              className="w-full sm:w-[264px]"
            >
              {busy
                ? 'Saving…'
                : truck
                  ? 'Save truck'
                  : 'Create truck association'}
            </Button>
          )}
          <Button asChild variant="outline" className="w-full sm:w-[264px]">
            <Link to="/admin/trucks" search={searchDefaults}>
              Cancel
            </Link>
          </Button>
        </div>
      </form>
      {truck && (
        <Card className="gap-4 rounded-xl p-6 shadow-none">
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
