import { useCallback, useEffect, useState, type FormEvent } from "react";
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
function Schedules() {
  const { session } = Route.useRouteContext();
  const [anchor, setAnchor] = useState(localDate),
    [mode, setMode] = useState<"week" | "month">("week"),
    [items, setItems] = useState<Entry[]>([]),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [from, to] = range(anchor, mode);
  const [selectedDriver, setSelectedDriver] = useState<ComboboxOption | null>(null),
    [selectedTruck, setSelectedTruck] = useState<ComboboxOption | null>(null),
    [start, setStart] = useState(from),
    [end, setEnd] = useState(to),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]),
    [note, setNote] = useState(""),
    [conflicts, setConflicts] = useState<
      Array<{
        id: string;
        date: string;
        driverName: string;
        registration: string;
      }>
    >([]),
    [cancel, setCancel] = useState<Entry | null>(null);
  const driverId = selectedDriver?.value ?? "";
  const truckId = selectedTruck?.value ?? "";
  const allowed = [
    "admin.access",
    "drivers.read",
    "drivers.write",
    "trucks.read",
    "trucks.write",
  ].every((p) => session.permissions.includes(p));
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/schedules?from=${from}&to=${to}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Could not load the schedule.");
      setItems((await r.json()).items);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the schedule.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => {
    if (allowed) void load();
  }, [load, allowed]);
  useEffect(() => {
    const update = () => {
      void load();
    };
    window.addEventListener("fleet:attention-changed", update);
    return () => window.removeEventListener("fleet:attention-changed", update);
  }, [load]);
  useEffect(() => {
    setStart(from);
    setEnd(to);
    setConflicts([]);
  }, [from, to]);
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
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const { r, data } = cancel
        ? await write(`schedules/${cancel.id}/cancel`, { note })
        : await write("schedules", {
            driverId,
            truckId,
            from: start,
            to: end,
            weekdays,
            note,
            override: conflicts.length > 0,
            expectedConflicts: conflicts.map((c) => c.id),
          });
      if (!r.ok) {
        if (data?.conflicts) setConflicts(data.conflicts);
        else setConflicts([]);
        throw new Error(data?.message ?? "Could not save the schedule.");
      }
      setSaved(
        cancel
          ? "Scheduled day cancelled."
          : `Schedule saved${data.overridden ? ` · ${data.overridden} scheduled days replaced` : ""}.`,
      );
      setCancel(null);
      setConflicts([]);
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the schedule.");
    } finally {
      setBusy(false);
    }
  }
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
      <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-3">
        <h1>Driver schedule</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={mode === "week" ? "default" : "outline"}
            onClick={() => setMode("week")}
          >
            Week
          </Button>
          <Button
            variant={mode === "month" ? "default" : "outline"}
            onClick={() => setMode("month")}
          >
            Month
          </Button>
          <Input
            aria-label="Schedule date"
            type="date"
            value={anchor}
            onChange={(e) => {
              if (e.target.value) setAnchor(e.target.value);
            }}
          />
        </div>
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
      <div className="mt-4 grid items-start gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="gap-0 overflow-hidden shadow-none">
          <div className="flex items-center justify-between border-b p-4">
            <p className="text-sm font-semibold">
              {from} – {to}
            </p>
            <Button variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          {loading ? (
            <p className="p-5 text-sm">Loading schedule…</p>
          ) : (
            <div className="divide-y">
              {days.map((day) => (
                <div
                  key={day}
                  className="grid gap-3 p-4 sm:grid-cols-[100px_1fr]"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {new Date(day + "T00:00Z").toLocaleDateString("en-ZA", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        timeZone: "UTC",
                      })}
                    </p>
                    {day === localDate() && (
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
                          className="flex items-center justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="space-y-1">
                            <p className="text-sm font-semibold">
                              {item.registration}
                            </p>
                            <p className="text-xs">{item.driverName}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setCancel(item);
                              setNote("");
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
        <Card className="p-5 shadow-none">
          <h2 className="text-base font-semibold">
            {cancel ? "Cancel scheduled day" : "Assign driver"}
          </h2>
          <form className="space-y-4" onSubmit={save}>
            <fieldset disabled={busy} className="space-y-4">
              {cancel ? (
                <p className="text-sm">
                  {cancel.date} · {cancel.driverName} · {cancel.registration}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-driver">Driver</Label>
                    <Combobox
                      id="schedule-driver"
                      name="driverId"
                      value={selectedDriver}
                      placeholder="Search name or driver number"
                      loadOptions={loadDrivers}
                      emptyMessage="No drivers found."
                      disabled={busy}
                      required
                      onValueChange={(driver) => {
                        setSelectedDriver(driver);
                        setConflicts([]);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-vehicle">Vehicle</Label>
                    <Combobox
                      id="schedule-vehicle"
                      name="truckId"
                      value={selectedTruck}
                      placeholder="Search registration or fleet number"
                      loadOptions={loadVehicles}
                      emptyMessage="No vehicles found."
                      disabled={busy}
                      required
                      onValueChange={(truck) => {
                        setSelectedTruck(truck);
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
                          setStart(e.target.value);
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
                          setEnd(e.target.value);
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
                                setWeekdays((v) =>
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
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                disabled={
                  busy ||
                  (!cancel && (!driverId || !truckId || !weekdays.length))
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
                    setNote("");
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
