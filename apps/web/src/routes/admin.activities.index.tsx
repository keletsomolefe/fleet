import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Camera } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar } from "@/components/filter-bar";
import { RefreshButton } from "@/components/refresh-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import {
  activityKindLabels,
  expenseCategoryLabels,
  flagLabels,
  formatZar,
  getActivityRecords,
  getDriverTimeline,
  getTransportCatalogue,
  reviewStatusLabels,
  type ActivityKind,
  type ReviewStatus,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/activities/")({
  loader: async ({ context }) => {
    if (!can(context.session, "activities.read")) return;
    const initialFilters = {
      truckId: "",
      kind: "",
      review: "",
      from: "",
      to: "",
      flaggedOnly: false,
    };
    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "transport-catalogue",
        ],
        queryFn: getTransportCatalogue,
      }),
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "transport-records",
          initialFilters,
        ],
        queryFn: () => getActivityRecords({}),
      }),
    ]);
  },
  component: ActivitiesIndexPage,
});

function ActivitiesIndexPage() {
  const { session } = Route.useRouteContext();
  const readable = can(session, "activities.read");
  const showMoney = can(session, "revenue.read");

  const [view, setView] = useState<"list" | "timeline">("list");
  const [truckId, setTruckId] = useState("");
  const [kind, setKind] = useState("");
  const [review, setReview] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const recordsQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "transport-records",
      { truckId, kind, review, from, to, flaggedOnly },
    ],
    queryFn: () =>
      getActivityRecords({
        truckId: truckId || undefined,
        kind: kind || undefined,
        review: review || undefined,
        from: from || undefined,
        to: to || undefined,
        flagged: flaggedOnly || undefined,
      }),
    enabled: readable && view === "list",
    refetchInterval: 20_000,
  });

  const timelineQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "transport-timeline",
      { truckId, from, to },
    ],
    queryFn: () =>
      getDriverTimeline({
        truckId: truckId || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    enabled: readable && view === "timeline",
    refetchInterval: 20_000,
  });

  if (!readable) {
    return <PageError message="You do not have access to Driver activity." />;
  }

  const records = recordsQuery.data ?? [];
  const timeline = timelineQuery.data?.items ?? [];
  const activeFilterCount =
    (truckId ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0) +
    (view === "list"
      ? (kind ? 1 : 0) + (review ? 1 : 0) + (flaggedOnly ? 1 : 0)
      : 0);

  function clearFilters() {
    setTruckId("");
    setKind("");
    setReview("");
    setFrom("");
    setTo("");
    setFlaggedOnly(false);
  }

  return (
    <>
      <PageHeader
        title="Driver activity"
        group="Operations"
        description="Pickups, deliveries, fuel purchases, road expenses and shift milestones."
        actions={
          <>
            <RefreshButton
              busy={recordsQuery.isFetching || timelineQuery.isFetching}
              onRefresh={() =>
                void (view === "list"
                  ? recordsQuery.refetch()
                  : timelineQuery.refetch())
              }
            />
            <ExportMenu
              dataset="activities"
              filters={{
                truckId: truckId || undefined,
                kind: kind || undefined,
                review: review || undefined,
                from: from || undefined,
                to: to || undefined,
                flagged: flaggedOnly || undefined,
              }}
            />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-1 rounded-xl border bg-background p-1 sm:inline-flex sm:w-fit">
        <Button
          size="sm"
          variant={view === "list" ? "default" : "ghost"}
          onClick={() => setView("list")}
          className="h-8 rounded-lg text-xs"
        >
          Activity records
        </Button>
        <Button
          size="sm"
          variant={view === "timeline" ? "default" : "ghost"}
          onClick={() => setView("timeline")}
          className="h-8 rounded-lg text-xs"
        >
          Journey timeline
        </Button>
      </div>

      <FilterBar
        activeCount={activeFilterCount}
        onClear={clearFilters}
        summary={
          <span className="text-xs text-muted-foreground tabular-nums">
            {view === "list"
              ? `${records.length} record${records.length === 1 ? "" : "s"}`
              : `${timeline.length} event${timeline.length === 1 ? "" : "s"}`}
          </span>
        }
      >
        <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-6 @md:items-end">
          <div className="space-y-1">
            <Label className="text-xs">Vehicle</Label>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
            >
              <option value="">All vehicles</option>
              {(catalogueQuery.data?.trucks ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.registration} · {t.identifier}
                </option>
              ))}
            </select>
          </div>
          {view === "list" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Activity type</Label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="">All types</option>
                  {(Object.keys(activityKindLabels) as ActivityKind[]).map((k) => (
                    <option key={k} value={k}>
                      {activityKindLabels[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Review status</Label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {(Object.keys(reviewStatusLabels) as ReviewStatus[]).map(
                    (r) => (
                      <option key={r} value={r}>
                        {reviewStatusLabels[r]}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3 @md:contents">
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                className="h-10 text-xs"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                className="h-10 text-xs"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          {view === "list" && (
            <label className="flex h-10 items-center gap-2 text-xs">
              <Checkbox
                checked={flaggedOnly}
                onCheckedChange={(v) => setFlaggedOnly(Boolean(v))}
              />
              Flagged only
            </label>
          )}
        </div>
      </FilterBar>

      {(recordsQuery.error || timelineQuery.error) && (
        <PageError
          message={(recordsQuery.error ?? timelineQuery.error)?.message ?? "Failed to load activity."}
        />
      )}

      {view === "list" ? (
        <Card className="gap-0 overflow-hidden py-0 shadow-none">
          {recordsQuery.isPending ? (
            <ListRowsSkeleton rows={5} />
          ) : !records.length ? (
            <EmptyState
              icon="activity"
              title="No driver activity yet"
              description="Collections, deliveries, fuel fill-ups and road expenses synced from driver phones appear here."
            />
          ) : (
            <ul className="divide-y">
              {records.map((rec) => (
                <li key={rec.id}>
                  <Link
                    to="/admin/activities/$recordId"
                    params={{ recordId: rec.id }}
                    className="grid gap-3 p-4 hover:bg-muted @2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_auto] @2xl:items-center sm:px-5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">
                          {activityKindLabels[rec.kind]}
                        </Badge>
                        <Badge
                          variant={
                            rec.review === "validated"
                              ? "default"
                              : rec.review === "clarification"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {reviewStatusLabels[rec.review]}
                        </Badge>
                        {(rec.attachmentCount ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Camera className="size-3.5" /> {rec.attachmentCount}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {rec.registration} · {rec.driverName} ·{" "}
                        {new Date(rec.occurredAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="min-w-0 space-y-1 text-sm">
                      {rec.kind === "fuel" ? (
                        <p>
                          {rec.data.fuelLitres ? `${rec.data.fuelLitres} L` : "Fuel"}
                          {rec.data.fuelTotalCost
                            ? ` · ${formatZar(rec.data.fuelTotalCost)}`
                            : " · Price missing"}
                          {rec.data.fuelStation ? ` · ${rec.data.fuelStation}` : ""}
                        </p>
                      ) : rec.kind === "expense" ? (
                        <p>
                          {expenseCategoryLabels[rec.data.expenseCategory ?? "other"] ??
                            "Expense"}
                          {rec.data.expenseAmount
                            ? ` · ${formatZar(rec.data.expenseAmount)}`
                            : ""}
                          {rec.data.vendorName ? ` · ${rec.data.vendorName}` : ""}
                        </p>
                      ) : (
                        <p>
                          <span className="font-medium">
                            {rec.data.quantity ?? "?"} {rec.data.unit}{" "}
                            {rec.data.product.name || "Product"}
                          </span>{" "}
                          · {rec.data.origin.name || "Origin"}
                          {rec.kind === "delivery"
                            ? ` → ${rec.data.destination.name || "Destination"}`
                            : ""}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {rec.kind === "collection" || rec.kind === "delivery"
                          ? `Customer: ${rec.data.customer.name || "Not recorded"}${rec.data.waybillNumber ? ` · Ref: ${rec.data.waybillNumber}` : ""}`
                          : rec.data.odometerKm
                            ? `Odometer: ${rec.data.odometerKm} km`
                            : rec.data.note || "No notes"}
                      </p>
                    </div>

                    <div className="min-w-0 space-y-1 text-xs">
                      {showMoney && rec.kind === "delivery" && (
                        <p className="text-sm font-semibold">
                          {rec.pricingStatus === "priced"
                            ? formatZar(rec.amount)
                            : rec.pricingStatus === "uncharged"
                              ? "Uncharged"
                              : "Needs rate"}
                        </p>
                      )}
                      {rec.flags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {rec.flags.slice(0, 3).map((flag) => (
                            <Badge
                              key={flag}
                              variant="destructive"
                              className="text-[10px]"
                            >
                              {flagLabels[flag] ?? flag}
                            </Badge>
                          ))}
                          {rec.flags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{rec.flags.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <ArrowRight
                      aria-hidden="true"
                      className="hidden size-4 text-muted-foreground sm:block"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0 shadow-none">
          {timelineQuery.isPending ? (
            <ListRowsSkeleton rows={5} />
          ) : !timeline.length ? (
            <EmptyState
              icon="activity"
              title="No timeline events found"
              description="Shift clock-ins, pickups, deliveries, fuel stops, road expenses and breakdowns appear chronologically here."
            />
          ) : (
            <ul className="divide-y">
              {timeline.map((ev) => (
                <li key={ev.id} className="flex flex-col gap-2 p-4 @2xl:flex-row @2xl:items-center @2xl:justify-between sm:px-5">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{ev.eventType.replace("_", " ")}</Badge>
                      <span className="text-xs font-medium">
                        {ev.registration} · {ev.driverName ?? "Unassigned"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(ev.timestamp).toLocaleString()}
                      </span>
                      {ev.attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Camera className="size-3.5" /> {ev.attachmentCount}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{ev.summary}</p>
                    {ev.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {ev.flags.map((f) => (
                          <Badge key={f} variant="destructive" className="text-[10px]">
                            {flagLabels[f] ?? f}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {ev.recordId && (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to="/admin/activities/$recordId"
                          params={{ recordId: ev.recordId }}
                        >
                          Inspect
                        </Link>
                      </Button>
                    )}
                    {ev.serviceJobId && (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to="/admin/jobs/$jobId"
                          params={{ jobId: ev.serviceJobId }}
                        >
                          Open job
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
