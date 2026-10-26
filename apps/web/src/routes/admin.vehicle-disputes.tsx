import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  getVehicleDisputes,
  type VehicleDispute,
  type DriverIssue,
  issueLabels,
} from "@/lib/vehicle-disputes";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { displayDate } from "@/lib/fleet";
export const Route = createFileRoute("/admin/vehicle-disputes")({
  loader: () => getVehicleDisputes(),
  staleTime: 0,
  gcTime: 0,
  component: Page,
});
function Page() {
  const data = Route.useLoaderData(),
    { session } = Route.useRouteContext(),
    router = useRouter();
  const [selected, setSelected] = useState<VehicleDispute | DriverIssue | null>(
      null,
    ),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  useEffect(() => {
    const update = () => {
      if (!selected) void router.invalidate();
    };
    window.addEventListener("fleet:attention-changed", update);
    return () => window.removeEventListener("fleet:attention-changed", update);
  }, [selected, router]);
  async function resolve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const r = await fetch(
        `/api/admin/${selected.kind === "issue" ? "issues" : "vehicle-disputes"}/${selected.id}/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify(
            selected.kind === "issue"
              ? { note }
              : {
                  expectedActiveSessionId:
                    selected.kind === "schedule"
                      ? (selected.requestedTruckSession?.id ?? null)
                      : (selected.currentDriver?.id ?? null),
                  ...(selected.kind === "schedule"
                    ? {
                        expectedScheduleId: selected.schedule?.id ?? null,
                        expectedRequestedScheduleId:
                          selected.requestedScheduleId,
                      }
                    : {}),
                  resolution: form.get("resolution"),
                  note,
                },
          ),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? "Could not resolve this item.");
      }
      setSelected(null);
      setNote("");
      setSaved("Item resolved.");
      window.dispatchEvent(new Event("fleet:attention-refresh"));
      await router.invalidate();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not resolve this item.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex min-h-[88px] items-center justify-between gap-4">
        <h1>Needs attention</h1>
        <Button
          variant="outline"
          onClick={() => {
            setSelected(null);
            void router.invalidate();
          }}
        >
          Refresh
        </Button>
      </div>
      {(error || data.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error || data.error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert role="status">
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      {selected ? (
        <Card className="gap-5 p-6 shadow-none">
          <h2 className="text-base font-semibold">
            Resolve {selected.truck?.registration ?? "issue"}
          </h2>
          <p className="text-sm">Flagged by {selected.requestedBy}</p>
          {selected.kind === "issue" && (
            <div className="space-y-2 text-sm">
              <p className="font-semibold">{issueLabels[selected.category]}</p>
              <p className="whitespace-pre-wrap break-words">
                {selected.description}
              </p>
              <p className="text-muted-foreground">
                {displayDate(selected.createdAt)}
              </p>
            </div>
          )}
          {selected.kind === "schedule" && (
            <div className="space-y-2 text-sm">
              <p>Schedule problem · {selected.scheduleDate}</p>
              <p>
                Requested vehicle:{" "}
                {selected.requestedTruck?.registration ?? "Not specified"}
              </p>
              <p>{selected.driverNote}</p>
              {selected.requestedScheduledDriver && (
                <p>
                  Scheduled driver for requested vehicle:{" "}
                  {selected.requestedScheduledDriver}
                </p>
              )}
            </div>
          )}
          {selected.kind !== "issue" && (
            <p className="text-sm">
              Current driver:{" "}
              {selected.currentDriver?.driverName ?? "No active driver"}
            </p>
          )}
          <form className="space-y-4" onSubmit={resolve}>
            <fieldset disabled={busy} className="space-y-4">
              {selected.kind !== "issue" && (
                <div className="space-y-2">
                  <Label htmlFor="resolution">Action</Label>
                  <select
                    id="resolution"
                    name="resolution"
                    required
                    className="h-12 w-full rounded-md border bg-white px-3 text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose an action
                    </option>
                    {selected.kind === "schedule" ? (
                      <>
                        <option value="keep_schedule">
                          Keep current schedule
                        </option>
                        <option
                          value="change_schedule"
                          disabled={!selected.requestedTruck}
                        >
                          Assign requested vehicle for this date
                        </option>
                      </>
                    ) : (
                      <>
                        <option
                          value="keep_current"
                          disabled={!selected.currentDriver}
                        >
                          Keep current driver
                        </option>
                        <option value="release_vehicle">Release vehicle</option>
                      </>
                    )}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="note">What was decided?</Label>
                <textarea
                  id="note"
                  required
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="min-h-24 w-full rounded-md border bg-white p-3 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button disabled={!note.trim()}>Resolve item</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelected(null)}
                >
                  Cancel
                </Button>
              </div>
            </fieldset>
          </form>
        </Card>
      ) : (
        <div className="grid gap-4">
          {!data.error && !data.items.length && (
            <Card className="p-6 shadow-none">
              <p className="text-sm text-muted-foreground">
                Nothing to resolve.
              </p>
            </Card>
          )}
          {data.items.map((d) => (
            <Card
              key={d.id}
              className="flex flex-wrap items-start justify-between gap-4 p-5 shadow-none"
            >
              <div className="space-y-2">
                <h2 className="text-sm font-semibold">
                  {d.truck
                    ? `${d.truck.registration} · ${d.truck.identifier}`
                    : "Driver issue"}
                </h2>
                <p className="text-xs">
                  {d.kind === "issue"
                    ? issueLabels[d.category]
                    : d.kind === "schedule"
                      ? "Schedule problem"
                      : "Vehicle in use"}{" "}
                  · {d.requestedBy}
                </p>
                {d.kind === "issue" && (
                  <p className="max-w-prose whitespace-pre-wrap break-words text-sm">
                    {d.description}
                  </p>
                )}
                {d.kind === "schedule" && (
                  <p className="text-xs text-muted-foreground">
                    {d.scheduleDate} · Requested{" "}
                    {d.requestedTruck?.registration ?? "vehicle not specified"}
                  </p>
                )}
                {d.kind !== "issue" && (
                  <p className="text-xs text-muted-foreground">
                    Current driver:{" "}
                    {d.currentDriver?.driverName ?? "No active driver"}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {displayDate(d.createdAt)}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(d);
                  setNote("");
                  setError("");
                  setSaved("");
                }}
              >
                Review
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
