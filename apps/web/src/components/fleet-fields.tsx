import type { ComponentProps, ChangeEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

export interface FieldDefinition {
  name: string
  label: string
  type?: string
  required?: boolean
  maxLength?: number
  min?: number
  max?: number
  options?: string[]
  hint?: string
}
export const truckGroups: Array<{ title: string; fields: FieldDefinition[] }> =
  [
    {
      title: 'Truck details',
      fields: [
        {
          name: 'identifier',
          label: 'Truck identifier',
          required: true,
          maxLength: 40,
        },
        {
          name: 'registration',
          label: 'Registration',
          required: true,
          maxLength: 30,
        },
        {
          name: 'registrationCountry',
          label: 'Registration country code',
          required: true,
          maxLength: 2,
          hint: 'Two letters, e.g. ZA',
        },
        {
          name: 'status',
          label: 'Availability',
          options: ['active', 'maintenance', 'inactive'],
          required: true,
        },
        { name: 'make', label: 'Make', required: true, maxLength: 80 },
        { name: 'model', label: 'Model', required: true, maxLength: 80 },
        {
          name: 'year',
          label: 'Year',
          type: 'number',
          min: 1950,
          max: new Date().getUTCFullYear() + 1,
        },
        { name: 'vin', label: 'VIN', maxLength: 17, hint: '17 characters' },
        { name: 'engineNumber', label: 'Engine number', maxLength: 80 },
        {
          name: 'category',
          label: 'Truck type',
          options: ['rigid', 'tractor', 'tipper', 'tanker', 'flatbed', 'other'],
          required: true,
        },
        {
          name: 'fuelType',
          label: 'Fuel type',
          options: ['diesel', 'petrol', 'electric', 'hybrid', 'other'],
          required: true,
        },
        {
          name: 'transmission',
          label: 'Transmission',
          options: ['manual', 'automatic', 'automated'],
        },
      ],
    },
    {
      title: 'Capacity & mileage',
      fields: [
        { name: 'axleCount', label: 'Axles', type: 'number', min: 2, max: 20 },
        {
          name: 'grossVehicleMassKg',
          label: 'Gross vehicle mass (kg)',
          type: 'number',
          min: 1,
          max: 200000,
        },
        {
          name: 'tareKg',
          label: 'Tare (kg)',
          type: 'number',
          min: 1,
          max: 200000,
        },
        {
          name: 'payloadCapacityKg',
          label: 'Payload capacity (kg)',
          type: 'number',
          min: 1,
          max: 200000,
        },
        {
          name: 'odometerKm',
          label: 'Odometer (km)',
          type: 'number',
          min: 0,
          max: 20000000,
          required: true,
        },
        {
          name: 'tankCapacityLitres',
          label: 'Fuel tank capacity (L)',
          type: 'number',
          min: 1,
          max: 10000,
        },
        {
          name: 'serviceIntervalKm',
          label: 'Service interval (km)',
          type: 'number',
          min: 1,
          max: 1000000,
        },
        {
          name: 'nextServiceDueKm',
          label: 'Next service due (km)',
          type: 'number',
          min: 0,
          max: 20000000,
        },
      ],
    },
    {
      title: 'Compliance & insurance',
      fields: [
        {
          name: 'licenceDiscExpiresOn',
          label: 'Licence disc expiry',
          type: 'date',
        },
        {
          name: 'roadworthyExpiresOn',
          label: 'Roadworthy expiry',
          type: 'date',
        },
        {
          name: 'insuranceProvider',
          label: 'Insurance provider',
          maxLength: 100,
        },
        {
          name: 'insurancePolicyNumber',
          label: 'Policy number',
          maxLength: 100,
        },
        { name: 'insuranceExpiresOn', label: 'Insurance expiry', type: 'date' },
      ],
    },
    {
      title: 'Truck device',
      fields: [
        { name: 'deviceIdentifier', label: 'Device identifier', maxLength: 80 },
        {
          name: 'deviceSerialNumber',
          label: 'Device serial number',
          maxLength: 100,
        },
      ],
    },
  ]
export const driverGroups: Array<{ title: string; fields: FieldDefinition[] }> =
  [
    {
      title: 'Driver details',
      fields: [
        {
          name: 'identifier',
          label: 'Driver identifier',
          required: true,
          maxLength: 40,
        },
        {
          name: 'phone',
          label: 'Phone number',
          type: 'tel',
          required: true,
          maxLength: 30,
        },
        {
          name: 'status',
          label: 'Driver status',
          options: ['active', 'inactive'],
          required: true,
        },
      ],
    },
    {
      title: 'Licence & PrDP',
      fields: [
        {
          name: 'licenceNumber',
          label: 'Licence number',
          required: true,
          maxLength: 80,
        },
        {
          name: 'licenceCode',
          label: 'Licence code',
          required: true,
          maxLength: 10,
        },
        {
          name: 'licenceCountry',
          label: 'Issuing country code',
          required: true,
          maxLength: 2,
          hint: 'Two letters, e.g. ZA',
        },
        {
          name: 'licenceExpiresOn',
          label: 'Licence expiry',
          type: 'date',
          required: true,
        },
        { name: 'prdpNumber', label: 'PrDP number', maxLength: 80 },
        { name: 'prdpExpiresOn', label: 'PrDP expiry', type: 'date' },
      ],
    },
    {
      title: 'Emergency contact',
      fields: [
        { name: 'emergencyContactName', label: 'Contact name', maxLength: 100 },
        {
          name: 'emergencyContactPhone',
          label: 'Contact phone',
          type: 'tel',
          maxLength: 30,
        },
      ],
    },
  ]
export const labelOption = (v: string) => v.charAt(0).toUpperCase() + v.slice(1)
export function FleetField({
  definition: f,
  value,
  ...props
}: { definition: FieldDefinition; value?: string | number | null } & Pick<
  ComponentProps<typeof Input>,
  'disabled' | 'minLength' | 'autoComplete'
> & {
    onChange?: (
      event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => void
  }) {
  const common = {
    id: f.name,
    name: f.name,
    required: f.required,
    defaultValue: value ?? '',
    'aria-describedby': f.hint ? `${f.name}-hint` : undefined,
    ...props,
  }
  return (
    <div className="space-y-2 min-w-0">
      <Label htmlFor={f.name} className="text-xs font-medium">
        {f.label}
        {f.required && <span aria-hidden="true"> *</span>}
      </Label>
      {f.options ? (
        <select
          {...common}
          className="flex h-12 w-full rounded-md border bg-muted px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {!f.required && <option value="">Not specified</option>}
          {f.options.map((o) => (
            <option key={o} value={o}>
              {labelOption(o)}
            </option>
          ))}
        </select>
      ) : (
        <Input
          {...common}
          type={f.type ?? 'text'}
          maxLength={f.maxLength}
          min={f.min}
          max={f.max}
          step={f.type === 'number' ? 1 : undefined}
          className="h-12 bg-muted shadow-none"
        />
      )}
      {f.hint && (
        <p id={`${f.name}-hint`} className="text-[11px] text-muted-foreground">
          {f.hint}
        </p>
      )}
    </div>
  )
}
export function FieldGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Card className="gap-5 rounded-xl p-6 shadow-none">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{children}</div>
    </Card>
  )
}
export function readFields(data: FormData, groups: typeof truckGroups) {
  return Object.fromEntries(
    groups
      .flatMap((g) => g.fields)
      .map((f) => {
        const value = data.get(f.name)
        return [
          f.name,
          f.type === 'number' ? (value ? Number(value) : null) : value || null,
        ]
      }),
  )
}
