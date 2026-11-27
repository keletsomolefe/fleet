import { useForm, useStore } from "@tanstack/react-form";
import { submitForm, textFieldProps } from "@/lib/form";
import { RepairForm } from "@/components/repair-form";
import { EmptyState } from "@/components/empty-state";
import { RefreshButton } from "@/components/refresh-button";
import { PageHeader } from "@/components/page-header";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
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
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<string | null>(null);
  const [selected, setSelected] = useState<VehicleDispute | DriverIssue | null>(
      null,
    ),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const {
    data,
    error: loadError,
    isPending,
    isFetching,
    refetch,
  } = useQuery({
    ...exceptionsQuery(session),
    enabled: !selected,
    refetchOnMount: false,
  });
  const items = data?.items ?? [];
  const pageError = error || data?.error || loadError?.message;
  const selectedJobActive =
    selected?.kind === "issue" &&
    selected.job &&
    ["open", "assigned", "in_progress"].includes(selected.job.status);
  const form = useForm({
    defaultValues: { resolution: "", note: "" },
    onSubmit: async ({ value: { resolution, note }, formApi }) => {
      if (!selected || !note.trim()) return;
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
                    resolution,
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
        formApi.reset();
        setSaved("Item resolved.");
        await refreshAdminOperations(queryClient, session.user.id);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not resolve this item.",
        );
      }
    },
  });
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const hasNote = useStore(form.store, (state) => !!state.values.note.trim());
  useEffect(() => {
    if (selected) reviewTitle.current?.focus();
    else if (returnTo.current) {
      document.getElementById(returnTo.current)?.focus();
      returnTo.current = null;
    }
  }, [selected]);
  const closeReview = () => {
    if (selected) returnTo.current = `review-${selected.id}`;
    setSelected(null);
    setError("");
  };
  return (
    <>
      <PageHeader
        title="Exceptions"
        group="Review & records"
        actions={
          !selected && (
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
          )
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
        <Card className="w-full max-w-3xl gap-4 p-4 shadow-none sm:p-6 [overflow-wrap:anywhere]">
          <h2
            ref={reviewTitle}
            tabIndex={-1}
            className="scroll-mt-4 rounded-sm text-base font-semibold"
          >
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
          {selected.kind === "issue" && selectedJobActive && selected.job ? (
            <div className="space-y-3 rounded-md border bg-muted p-4 text-sm">
              <p className="font-semibold">
                Service job {selected.job.reference}
              </p>
              <p className="text-muted-foreground">
                {selected.job.status === "open"
                  ? "Waiting for a provider to accept."
                  : selected.job.provider
                    ? `${selected.job.provider.companyName} is handling this job.`
                    : "This job is active."}
              </p>
              <Button asChild>
                <Link
                  to="/admin/jobs/$jobId"
                  params={{ jobId: selected.job.id }}
                >
                  View service job
                </Link>
              </Button>
            </div>
          ) : selected.kind === "issue" &&
          selected.category === "vehicle" &&
          selected.truck &&
          !selected.job ? (
            <RepairForm
              endpoint={`/api/admin/issues/${selected.id}/repair/resolve`}
              headers={{ "X-CSRF-Token": session.csrfToken }}
              onCancel={closeReview}
              onSaved={async () => {
                setSelected(null);
                setSaved("Issue resolved.");
                await refreshAdminOperations(queryClient, session.user.id);
              }}
            />
          ) : (
            <form className="space-y-4" onSubmit={submitForm(form)}>
              <fieldset disabled={busy} className="space-y-4">
                {selected.kind !== "issue" && (
                  <div className="space-y-2">
                    <Label htmlFor="resolution">Action</Label>
                    <form.Field name="resolution">
                      {(field) => (
                        <select
                          id="resolution"
                          name="resolution"
                          required
                          className="h-12 w-full rounded-md border bg-background pl-3.5 pr-10 text-sm"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.currentTarget.value)
                          }
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
                      )}
                    </form.Field>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="note">What was decided?</Label>
                  <form.Field name="note">
                    {(field) => (
                      <textarea
                        id="note"
                        required
                        maxLength={1000}
                        {...textFieldProps(field)}
                        className="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                      />
                    )}
                  </form.Field>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button disabled={!hasNote}>Resolve item</Button>
                  <Button type="button" variant="outline" onClick={closeReview}>
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
            <Card className="gap-0 overflow-hidden py-0 shadow-none">
              <ListRowsSkeleton rows={4} />
            </Card>
          )}
          {!isPending && !pageError && !items.length && (
            <Card className="py-0 shadow-none">
              <EmptyState icon="alert" title="No open exceptions" />
            </Card>
          )}
          {items.map((d) => (
            <Card
              key={d.id}
              className="gap-4 p-4 shadow-none @2xl:flex-row @2xl:items-start @2xl:justify-between sm:p-5"
            >
              <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
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
                {d.kind === "issue" && d.job && (
                  <p className="text-xs text-muted-foreground">
                    Service job {d.job.reference}
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
                id={`review-${d.id}`}
                variant="outline"
                className="w-full sm:w-auto"
                aria-label={`Review ${d.truck?.registration ?? "report"} from ${d.requestedBy}`}
                onClick={() => {
                  setSelected(d);
                  form.reset();
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
