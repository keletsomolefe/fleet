// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Combobox, type ComboboxOption } from './combobox'

const patrick = { value: 'driver-patrick', label: 'Patrick Molefe · D001' }
const demo = { value: 'driver-demo', label: 'Demo Driver · D002' }
type Load = (query: string, signal: AbortSignal) => Promise<ComboboxOption[]>

function Field({ loadOptions, initial = null, disabled = false }: { loadOptions: Load; initial?: ComboboxOption | null; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <form aria-label="Assignment">
      <label htmlFor="driver">Driver</label>
      <Combobox id="driver" name="driverId" value={value} onValueChange={setValue} loadOptions={loadOptions} required disabled={disabled} />
      <button type="submit">Save</button>
    </form>
  )
}
const chosen = () => new FormData(screen.getByRole('form') as HTMLFormElement).get('driverId')

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Searchable selection', () => {
  it('searches, selects with the keyboard and submits the ID in one field', async () => {
    const load = vi.fn<Load>().mockResolvedValue([demo])
    render(<Field loadOptions={load} />)
    const input = screen.getByRole('combobox', { name: 'Driver' })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'dem' } })
    await screen.findByRole('option', { name: demo.label })
    expect(load.mock.calls.at(-1)?.[0]).toBe('dem')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(chosen()).toBe(demo.value))
    expect((input as HTMLInputElement).value).toBe(demo.label)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('clears an existing selection when editing so typed text cannot submit the old driver', async () => {
    render(<Field loadOptions={async () => [demo]} initial={patrick} />)
    const input = screen.getByRole('combobox')
    expect((input as HTMLInputElement).value).toBe(patrick.label)
    expect(chosen()).toBe(patrick.value)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'dem' } })
    expect(chosen()).toBe('')
    expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(false)
    expect((input as HTMLInputElement).value).toBe('dem')
    fireEvent.click(await screen.findByRole('option', { name: demo.label }))
    expect(chosen()).toBe(demo.value)
    expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(chosen()).toBe('')
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('ignores a late response for an older search', async () => {
    let finishOld!: (items: ComboboxOption[]) => void
    const load = vi.fn<Load>((query) => query === 'pat'
      ? new Promise((resolve) => { finishOld = resolve })
      : Promise.resolve([demo]))
    render(<Field loadOptions={load} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'pat' } })
    await waitFor(() => expect(load).toHaveBeenCalled())
    fireEvent.change(input, { target: { value: 'dem' } })
    await screen.findByRole('option', { name: demo.label })
    await act(async () => finishOld([patrick]))
    expect(screen.queryByRole('option', { name: patrick.label })).toBeNull()
    expect(screen.getByRole('option', { name: demo.label })).toBeTruthy()
  })

  it('shows empty and error states, and retries a failed search', async () => {
    const load = vi.fn<Load>().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Network')).mockResolvedValue([demo])
    render(<Field loadOptions={load} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'none' } })
    await screen.findByText('No matches found.')
    fireEvent.change(input, { target: { value: 'dem' } })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('option', { name: demo.label })
  })

  it('keeps a saved selection visible when it is outside the current results', async () => {
    render(<Field loadOptions={async () => [demo]} initial={patrick} />)
    fireEvent.focus(screen.getByRole('combobox'))
    await screen.findByRole('option', { name: demo.label })
    expect(screen.getByRole('option', { name: patrick.label }).getAttribute('aria-selected')).toBe('true')
    expect(chosen()).toBe(patrick.value)
  })

  it('disables searching and changing a disabled selection', () => {
    const load = vi.fn<Load>()
    render(<Field loadOptions={load} initial={patrick} disabled />)
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Show choices' }) as HTMLButtonElement).disabled).toBe(true)
    expect(load).not.toHaveBeenCalled()
  })

  it('closes with Escape without choosing the typed text', async () => {
    render(<Field loadOptions={async () => [demo]} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'dem' } })
    await screen.findByRole('option', { name: demo.label })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(chosen()).toBe('')
  })
})
