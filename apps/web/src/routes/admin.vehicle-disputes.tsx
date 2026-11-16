import { RepairForm } from "@/components/repair-form";
import { PageHeader } from "@/components/page-header";
import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminOperationsKey, refreshAdminOperations } from "@/lib/admin-queries";
import type { AdminSession } from "@/lib/auth";
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
const exceptionsQuery = (session: AdminSession) =>
  queryOptions({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "exceptions",
      session.permissions,
    ],
    queryFn: ({ signal }) => getVehicleDisputes({ signal }),
  });

export const Route = createFileRoute("/admin/vehicle-disputes")({
  loader: async ({ context }) => {
    await context.queryClient.query(exceptionsQuery(context.session));
  },
  staleTime: 0,
  gcTime: 0,
  component: Page,
});
function Page() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<VehicleDispute | DriverIssue | null>(
      null,
    ),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const { data, error: loadError, isPending } = useQuery({
    ...exceptionsQuery(session),
    enabled: !selected,
    refetchOnMount: false,
  });
  const items = data?.items ?? [];
  const pageError = error || data?.error || loadError?.message;
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
      await refreshAdminOperations(queryClient, session.user.id);
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
      <PageHeader
        title="Exceptions"
        group="Review & records"
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setSelected(null);
              setError("");
              void queryClient.invalidateQueries({
                queryKey: exceptionsQuery(session).queryKey,
              });
            }}
          >
            Refresh
          </Button>
        }
      />
      {pageError && (
        <Alert variant="destructive">
          <AlertDescription>{pageError}</AlertDescription>
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
          {selected.kind === "issue" &&
          selected.category === "vehicle" &&
          selected.truck ? (
            <RepairForm
              endpoint={`/api/admin/issues/${selected.id}/repair/resolve`}
              headers={{ "X-CSRF-Token": session.csrfToken }}
              onSaved={async () => {
                setSelected(null);
                setSaved("Issue resolved.");
                await refreshAdminOperations(queryClient, session.user.id);
              }}
            />
          ) : (
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
                          <option value="release_vehicle">
                            Release vehicle
                          </option>
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
          )}
        </Card>
      ) : (
        <div className="grid gap-4">
          {isPending && !pageError && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading items…
            </p>
          )}
          {!isPending && !pageError && !items.length && (
            <Card className="p-6 shadow-none">
              <p className="text-sm text-muted-foreground">
                Nothing to resolve.
              </p>
            </Card>
          )}
          {items.map((d) => (
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
