import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [driverQuery, setDriverQuery] = useState(""),
    [truckQuery, setTruckQuery] = useState(""),
    [drivers, setDrivers] = useState<Driver[]>([]),
    [trucks, setTrucks] = useState<Truck[]>([]),
    [driverId, setDriverId] = useState(""),
    [truckId, setTruckId] = useState(""),
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
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void Promise.all([
        fetch(
          `/api/admin/drivers?q=${encodeURIComponent(driverQuery)}&status=active`,
        ),
        fetch(
          `/api/admin/trucks?q=${encodeURIComponent(truckQuery)}&status=active`,
        ),
      ])
        .then(async ([a, b]) => {
          if (!a.ok || !b.ok)
            throw new Error("Could not load drivers and vehicles.");
          const [d, t] = await Promise.all([a.json(), b.json()]);
          if (active) {
            setDrivers(d.items);
            setTrucks(t.items);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [driverQuery, truckQuery]);
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
          : `Schedule saved${data.overridden ? ` · ${data.overridden} assignments overridden` : ""}.`,
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
                    <Label htmlFor="driver-search">Driver</Label>
                    <Input
                      id="driver-search"
                      value={driverQuery}
                      placeholder="Search name or driver number"
                      onChange={(e) => {
                        setDriverQuery(e.target.value);
                        setDriverId("");
                        setConflicts([]);
                      }}
                    />
                    <select
                      aria-label="Choose driver"
                      required
                      value={driverId}
                      onChange={(e) => {
                        setDriverId(e.target.value);
                        setConflicts([]);
                      }}
                      className="h-12 w-full rounded-md border px-3 text-sm"
                    >
                      <option value="">Choose driver</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.user.firstName} {d.user.lastName} · {d.identifier}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-search">Vehicle</Label>
                    <Input
                      id="vehicle-search"
                      value={truckQuery}
                      placeholder="Search registration or fleet number"
                      onChange={(e) => {
                        setTruckQuery(e.target.value);
                        setTruckId("");
                        setConflicts([]);
                      }}
                    />
                    <select
                      aria-label="Choose vehicle"
                      required
                      value={truckId}
                      onChange={(e) => {
                        setTruckId(e.target.value);
                        setConflicts([]);
                      }}
                      className="h-12 w-full rounded-md border px-3 text-sm"
                    >
                      <option value="">Choose vehicle</option>
                      {trucks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.registration} · {t.identifier}
                        </option>
                      ))}
                    </select>
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
                    {conflicts.length} conflicting assignments:{" "}
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
                      ? "Override conflicting dates"
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
                  Back to assignment
                </Button>
              )}
            </fieldset>
          </form>
        </Card>
      </div>
    </>
  );
}
