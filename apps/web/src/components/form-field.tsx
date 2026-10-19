import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function FormField({
  label,
  hint,
  ...props
}: ComponentProps<typeof Input> & { label: string; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id} className="text-xs font-medium leading-[18px]">
        {label}
      </Label>
      <Input
        {...props}
        aria-describedby={hint ? `${props.id}-hint` : undefined}
        className="bg-white shadow-none"
      />
      {hint && (
        <p
          id={`${props.id}-hint`}
          className="text-[11px] leading-4 text-muted-foreground"
        >
          {hint}
        </p>
      )}
    </div>
  )
}
