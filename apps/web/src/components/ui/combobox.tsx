import { useEffect, useState } from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export type ComboboxOption = { value: string; label: string }

export function Combobox({
  id,
  name,
  value,
  onValueChange,
  loadOptions,
  placeholder = 'Search…',
  emptyMessage = 'No matches found.',
  required = false,
  disabled = false,
}: {
  id: string
  name?: string
  value: ComboboxOption | null
  onValueChange: (value: ComboboxOption | null) => void
  loadOptions: (query: string, signal: AbortSignal) => Promise<ComboboxOption[]>
  placeholder?: string
  emptyMessage?: string
  required?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ComboboxOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!open || disabled) return
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    setOptions([])
    const timer = setTimeout(() => {
      void loadOptions(query.trim(), controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setOptions(result)
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [open, query, disabled, loadOptions, retry])

  // Keep the chosen item available when the next search returns a different page.
  const items =
    value && !options.some((option) => option.value === value.value)
      ? [value, ...options]
      : options

  return (
    <ComboboxPrimitive.Root
      items={items}
      value={value}
      inputValue={query || value?.label || ''}
      onValueChange={(next) => {
        onValueChange(next)
        setQuery('')
      }}
      onInputValueChange={(text, { reason }) => {
        if (reason !== 'input-change' && reason !== 'clear-press') return
        setQuery(text)
        setOptions([])
        setLoading(true)
        setError(false)
        if (value && text !== value.label) onValueChange(null)
      }}
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(item, selected) => item.value === selected.value}
      filter={null}
      name={name}
      required={required}
      disabled={disabled}
    >
      <ComboboxPrimitive.InputGroup className="relative w-full">
        <ComboboxPrimitive.Input
          id={id}
          placeholder={placeholder}
          maxLength={200}
          onFocus={() => setOpen(true)}
          render={<Input className="bg-white pr-20" />}
        />
        <div className="absolute inset-y-0 right-1 flex items-center">
          <ComboboxPrimitive.Clear
            aria-label="Clear selection"
            render={<Button type="button" variant="ghost" size="icon-sm" />}
          >
            <X className="size-4" />
          </ComboboxPrimitive.Clear>
          <ComboboxPrimitive.Trigger
            aria-label="Show choices"
            render={<Button type="button" variant="ghost" size="icon-sm" />}
          >
            <ChevronDown className="size-4" />
          </ComboboxPrimitive.Trigger>
        </div>
      </ComboboxPrimitive.InputGroup>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} className="z-50">
          <ComboboxPrimitive.Popup
            className="w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
            aria-busy={loading}
          >
            <ComboboxPrimitive.Status>
              {loading && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" /> Searching…
                </div>
              )}
            </ComboboxPrimitive.Status>
            {error ? (
              <div className="space-y-2 p-3 text-sm">
                <p role="alert">Could not load choices.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRetry((attempt) => attempt + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <>
                {!loading && (
                  <ComboboxPrimitive.Empty className="p-3 text-sm text-muted-foreground">
                    {emptyMessage}
                  </ComboboxPrimitive.Empty>
                )}
                <ComboboxPrimitive.List className="max-h-[min(18rem,var(--available-height))] scroll-py-1 overflow-y-auto p-1 empty:p-0">
                  {(option: ComboboxOption) => (
                    <ComboboxPrimitive.Item
                      key={option.value}
                      value={option}
                      className="relative flex min-h-11 cursor-default items-center rounded-sm py-2 pr-9 pl-3 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    >
                      <span className="break-words">{option.label}</span>
                      <ComboboxPrimitive.ItemIndicator className="absolute right-3">
                        <Check className="size-4" />
                      </ComboboxPrimitive.ItemIndicator>
                    </ComboboxPrimitive.Item>
                  )}
                </ComboboxPrimitive.List>
              </>
            )}
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
