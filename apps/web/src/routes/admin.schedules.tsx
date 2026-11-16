import { Plus } from "lucide-react";
import { RefreshButton } from "@/components/refresh-button";
import { PageHeader } from "@/components/page-header";
import { useEffect, useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { submitForm } from "@/lib/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Driver, Truck } from "@/lib/fleet";
export const Route = createFileRoute("/admin/schedules")({
  component: Schedules,
});
type Entry = {
  id: string;
  date: string;
  driverId: string;
  truckId: string;
  registration: string;
  driverName: string;
  note: string;
};
async function loadDrivers(
  query: string,
  signal: AbortSignal,
): Promise<ComboboxOption[]> {
  const response = await fetch(
    `/api/admin/drivers?q=${encodeURIComponent(query)}&status=active`,
    { signal, cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not load drivers.");
  const data = (await response.json()) as { items: Driver[] };
  return data.items.map((driver) => ({
    value: driver.id,
    label: `${driver.user.firstName} ${driver.user.lastName} · ${driver.identifier}`,
  }));
}
async function loadVehicles(
  query: string,
  signal: AbortSignal,
): Promise<ComboboxOption[]> {
  const response = await fetch(
    `/api/admin/trucks?q=${encodeURIComponent(query)}&status=active`,
    { signal, cache: "no-store" },
  );
  if (!response.ok) throw new Error("Could not load vehicles.");
  const data = (await response.json()) as { items: Truck[] };
  return data.items.map((truck) => ({
    value: truck.id,
    label: `${truck.registration} · ${truck.identifier}`,
  }));
}
function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function range(anchor: string, mode: "week" | "month") {
  const d = new Date(anchor + "T00:00:00Z"),
    start = new Date(d),
    end = new Date(d);
  if (mode === "week") {
    start.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    end.setTime(start.getTime() + 6 * 86400000);
  } else {
    start.setUTCDate(1);
    end.setUTCMonth(d.getUTCMonth() + 1, 0);
  }
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}
const dateFormat = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dayFormat = new Intl.DateTimeFormat("en-ZA", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dateValue = (value: string) => new Date(value + "T00:00:00Z");

function Schedules() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const editor = useRef<HTMLHeadingElement>(null);
  const cancelTrigger = useRef<HTMLButtonElement | null>(null);
  const today = localDate();
  const [anchor, setAnchor] = useState(localDate),
    [mode, setMode] = useState<"week" | "month">("week"),
    [saveError, setSaveError] = useState(""),
    [saved, setSaved] = useState("");
  const [from, to] = range(anchor, mode);
  const [conflicts, setConflicts] = useState<
      Array<{
        id: string;
        date: string;
        driverName: string;
        registration: string;
      }>
    >([]),
    [cancel, setCancel] = useState<Entry | null>(null);
  const allowed = [
    "admin.access",
    "drivers.read",
    "drivers.write",
    "trucks.read",
    "trucks.write",
  ].every((p) => session.permissions.includes(p));
  const {
    data: items,
    error: loadError,
    isPending,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "schedules", from, to],
    enabled: allowed,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/admin/schedules?from=${from}&to=${to}`,
        {
          cache: "no-store",
          signal,
        },
      );
      if (!response.ok) throw new Error("Could not load the schedule.");
      const data = (await response.json()) as { items: Entry[] };
      return data.items;
    },
  });
  async function write(path: string, body: unknown) {
    const r = await fetch("/api/admin/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    return { r, data };
  }
  const form = useForm({
    defaultValues: {
      driver: null as ComboboxOption | null,
      truck: null as ComboboxOption | null,
      start: from,
      end: to,
      weekdays: [1, 2, 3, 4, 5],
      note: "",
    },
    validators: {
      onSubmit: ({ value }) =>
        (cancel || conflicts.length > 0) && !value.note.trim()
          ? "Enter a reason."
          : undefined,
    },
    onSubmit: async ({ value, formApi }) => {
      if (!allowed) return;
      const { driver, truck, start, end, weekdays, note } = value;
      setSaveError("");
      setSaved("");
      try {
        const { r, data } = cancel
          ? await write(`schedules/${cancel.id}/cancel`, { note })
          : driver && truck && weekdays.length
            ? await write("schedules", {
                driverId: driver.value,
                truckId: truck.value,
                from: start,
                to: end,
                weekdays,
                note,
                override: conflicts.length > 0,
                expectedConflicts: conflicts.map((c) => c.id),
              })
            : { r: null, data: null };
        if (!r) return;
        if (!r.ok) {
          setConflicts(data?.conflicts ?? []);
          throw new Error(data?.message ?? "Could not save the schedule.");
        }
        setSaved(
          cancel
            ? "Scheduled day cancelled."
            : `Schedule saved${data.overridden ? ` · ${data.overridden} scheduled days replaced` : ""}.`,
        );
        setCancel(null);
        setConflicts([]);
        formApi.resetField("note");
        await refreshAdminOperations(queryClient, session.user.id);
      } catch (e) {
        setSaveError(
          e instanceof Error ? e.message : "Could not save the schedule.",
        );
      }
    },
  });
  const { driver, truck, start, end, weekdays, note } = useStore(
    form.store,
    (state) => state.values,
  );
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  useEffect(() => {
    if (cancel) editor.current?.focus();
  }, [cancel]);
  useEffect(() => {
    form.setFieldValue("start", from, { dontUpdateMeta: true });
    form.setFieldValue("end", to, { dontUpdateMeta: true });
    setConflicts([]);
  }, [form, from, to]);
  if (!allowed)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          You do not have access to driver scheduling.
        </AlertDescription>
      </Alert>
    );
  const days = Array.from(
    { length: (Date.parse(to) - Date.parse(from)) / 86400000 + 1 },
    (_, i) =>
      new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
  );
  return (
    <>
      <PageHeader
        title="Driver schedule"
        group="People & assets"
        actions={
          <Button
            className="w-full sm:w-auto xl:hidden"
            onClick={() => editor.current?.focus()}
          >
            <Plus aria-hidden="true" />
            {cancel ? "Review cancellation" : "Assign driver"}
          </Button>
        }
      />
      {saved && (
        <Alert role="status">
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="gap-0 overflow-hidden py-0 shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div
              role="group"
              aria-label="Schedule view"
              className="flex items-center gap-1 rounded-lg bg-muted p-1"
            >
              {(["week", "month"] as const).map((period) => (
                <Button
                  key={period}
                  size="sm"
                  disabled={busy}
                  aria-pressed={mode === period}
                  variant={mode === period ? "default" : "ghost"}
                  onClick={() => setMode(period)}
                >
                  {period === "week" ? "Week" : "Month"}
                </Button>
              ))}
            </div>
            <Input
              aria-label="Schedule date"
              disabled={busy}
              className="h-10 w-auto max-w-full bg-background"
              type="date"
              value={anchor}
              onChange={(e) => {
                if (
                  e.target.value &&
                  Number.isFinite(Date.parse(e.target.value))
                )
                  setAnchor(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <h2 className="text-sm font-semibold">
              {dateFormat.formatRange(dateValue(from), dateValue(to))}
            </h2>
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
          </div>
          {loadError && (
            <Alert variant="destructive" className="m-4 w-auto">
              <AlertDescription>{loadError.message}</AlertDescription>
            </Alert>
          )}
          {isPending && (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Loading schedule…
            </p>
          )}
          {items && (
            <div className="divide-y">
              {days.map((day) => (
                <div
                  key={day}
                  className={`grid gap-3 p-4 sm:grid-cols-[100px_minmax(0,1fr)] ${day === today ? "bg-muted/60" : ""}`}
                >
                  <div>
                    <p className="text-sm font-semibold">
                      <time dateTime={day}>
                        {dayFormat.format(dateValue(day))}
                      </time>
                    </p>
                    {day === today && (
                      <p className="text-xs text-muted-foreground">Today</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    {!items.some((i) => i.date === day) && (
                      <p className="text-xs text-muted-foreground">
                        No drivers scheduled
                      </p>
                    )}
                    {items
                      .filter((i) => i.date === day)
                      .map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3"
                        >
                          <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                            <p className="text-sm font-semibold">
                              {item.registration}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {item.driverName}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={(event) => {
                              cancelTrigger.current = event.currentTarget;
                              setSaveError("");
                              setCancel(item);
                              form.resetField("note");
                              setConflicts([]);
                              setSaved("");
                            }}
                          >
                            Cancel day
                          </Button>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="gap-4 p-4 shadow-none sm:p-5">
          <h2
            ref={editor}
            tabIndex={-1}
            className="scroll-mt-4 rounded-sm text-base font-semibold"
          >
            {cancel ? "Cancel scheduled day" : "Assign driver"}
          </h2>
          {saveError && (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
          <form className="space-y-4" onSubmit={submitForm(form)}>
            <fieldset disabled={busy} className="space-y-4">
              {cancel ? (
                <div className="space-y-1 rounded-lg border bg-muted p-3 [overflow-wrap:anywhere]">
                  <p className="font-semibold">
                    {cancel.registration} · {cancel.driverName}
                  </p>
                  <time
                    className="text-sm text-muted-foreground"
                    dateTime={cancel.date}
                  >
                    {dateFormat.format(dateValue(cancel.date))}
                  </time>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-driver">Driver</Label>
                    <Combobox
                      id="schedule-driver"
                      name="driverId"
                      value={driver}
                      placeholder="Name or driver number"
                      optionsKey={["admin", session.user.id, "active-drivers"]}
                      loadOptions={loadDrivers}
                      emptyMessage="No drivers found."
                      disabled={busy}
                      required
                      onValueChange={(driver) => {
                        form.setFieldValue("driver", driver);
                        setConflicts([]);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-vehicle">Vehicle</Label>
                    <Combobox
                      id="schedule-vehicle"
                      name="truckId"
                      value={truck}
                      placeholder="Registration or fleet number"
                      optionsKey={["admin", session.user.id, "active-vehicles"]}
                      loadOptions={loadVehicles}
                      emptyMessage="No vehicles found."
                      disabled={busy}
                      required
                      onValueChange={(truck) => {
                        form.setFieldValue("truck", truck);
                        setConflicts([]);
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="start">From</Label>
                      <Input
                        id="start"
                        type="date"
                        required
                        value={start}
                        onChange={(e) => {
                          form.setFieldValue("start", e.target.value);
                          setConflicts([]);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="end">To</Label>
                      <Input
                        id="end"
                        type="date"
                        required
                        min={start}
                        value={end}
                        onChange={(e) => {
                          form.setFieldValue("end", e.target.value);
                          setConflicts([]);
                        }}
                      />
                    </div>
                  </div>
                  <fieldset>
                    <legend className="mb-2 text-sm">Repeat on</legend>
                    <div className="flex flex-wrap gap-2">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (label, d) => (
                          <label
                            key={label}
                            className="flex items-center gap-1 rounded-md border px-2 py-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              className="accent-black"
                              checked={weekdays.includes(d)}
                              onChange={(e) => {
                                form.setFieldValue("weekdays", (v) =>
                                  e.target.checked
                                    ? [...v, d]
                                    : v.filter((x) => x !== d),
                                );
                                setConflicts([]);
                              }}
                            />
                            {label}
                          </label>
                        ),
                      )}
                    </div>
                  </fieldset>
                </>
              )}
              {!!conflicts.length && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {conflicts.length} scheduled days overlap:{" "}
                    {[...new Set(conflicts.map((c) => c.date))].join(", ")}.
                    Saving will replace them.
                    <ul className="mt-2 space-y-1">
                      {conflicts.map((c) => (
                        <li key={c.id}>
                          {c.date} · {c.driverName} · {c.registration}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="schedule-note">
                  {cancel || conflicts.length ? "Reason" : "Note (optional)"}
                </Label>
                <textarea
                  id="schedule-note"
                  className="min-h-24 w-full rounded-md border p-3 text-sm"
                  value={note}
                  maxLength={1000}
                  required={!!cancel || conflicts.length > 0}
                  onChange={(e) => form.setFieldValue("note", e.target.value)}
                />
              </div>
              {validationError && (
                <Alert variant="destructive">
                  <AlertDescription>{validationError}</AlertDescription>
                </Alert>
              )}
              <Button
                className="w-full"
                disabled={
                  busy || (!cancel && (!driver || !truck || !weekdays.length))
                }
              >
                {busy
                  ? "Saving…"
                  : cancel
                    ? "Cancel scheduled day"
                    : conflicts.length
                      ? "Replace scheduled days"
                      : "Save schedule"}
              </Button>
              {cancel && (
                <Button
                  variant="outline"
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setCancel(null);
                    setSaveError("");
                    form.resetField("note");
                    cancelTrigger.current?.focus();
                  }}
                >
                  Back to schedule
                </Button>
              )}
            </fieldset>
          </form>
        </Card>
      </div>
    </>
  );
}
