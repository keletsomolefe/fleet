import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar } from "@/components/filter-bar";
import { RefreshButton } from "@/components/refresh-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import {
  attachmentUrl,
  flagLabels,
  getShifts,
  getTransportCatalogue,
  reviewShiftMileage,
  type ShiftRowDto,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/shifts")({
  loader: async ({ context }) => {
    if (!can(context.session, "shifts.read")) return;
    const initialFilters = { truckId: "", from: "", to: "", flaggedOnly: false };
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
          "shifts",
          initialFilters,
        ],
        queryFn: () => getShifts({}),
      }),
    ]);
  },
  component: ShiftsPage,
});

function ShiftsPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "shifts.read");
  const reviewable = can(session, "activities.review");

  const [truckId, setTruckId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const [reviewing, setReviewing] = useState<ShiftRowDto | null>(null);
  const [startKm, setStartKm] = useState("");
  const [endKm, setEndKm] = useState("");
  const [clearPhotos, setClearPhotos] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const shiftsQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "shifts",
      { truckId, from, to, flaggedOnly },
    ],
    queryFn: () =>
      getShifts({
        truckId: truckId || undefined,
        from: from || undefined,
        to: to || undefined,
        flagged: flaggedOnly || undefined,
      }),
    enabled: readable,
    refetchInterval: 20_000,
  });

  if (!readable) {
    return <PageError message="You do not have access to Shifts & mileage." />;
  }

  function openReview(shift: ShiftRowDto) {
    setReviewing(shift);
    setStartKm(shift.startOdometerKm ?? "");
    setEndKm(shift.endOdometerKm ?? "");
    setClearPhotos(true);
    setReason("");
    setFormError("");
  }

  async function handleReview(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewing) return;
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      await reviewShiftMileage(session.csrfToken, reviewing.id, {
        startOdometerKm: startKm.trim() || null,
        endOdometerKm: endKm.trim() || null,
        clearMissingPhotoFlags: clearPhotos,
        reason,
      });
      setReviewing(null);
      setStatusMessage("Shift mileage reviewed and logged.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save review.",
      );
    } finally {
      setBusy(false);
    }
  }

  const shifts = shiftsQuery.data?.items ?? [];
  const activeFilterCount =
    (truckId ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (flaggedOnly ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Shifts & mileage"
        group="Operations"
        description="Start/end odometer readings, dashboard photos, distance travelled, and exceptions."
        actions={
          <>
            <RefreshButton
              busy={shiftsQuery.isFetching}
              onRefresh={() => void shiftsQuery.refetch()}
            />
            <ExportMenu
              dataset="shifts"
              filters={{
                truckId: truckId || undefined,
                from: from || undefined,
                to: to || undefined,
                flagged: flaggedOnly || undefined,
              }}
            />
          </>
        }
      />

      {statusMessage && (
        <Alert role="status">
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}
      {shiftsQuery.error && <PageError message={shiftsQuery.error.message} />}
      {formError && <PageError message={formError} />}

      <FilterBar
        activeCount={activeFilterCount}
        onClear={() => {
          setTruckId("");
          setFrom("");
          setTo("");
          setFlaggedOnly(false);
        }}
        summary={
          <span className="text-xs text-muted-foreground tabular-nums">
            {shifts.length} shift{shifts.length === 1 ? "" : "s"}
          </span>
        }
      >
        <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4 @md:items-end">
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
          <div className="grid grid-cols-2 gap-3 @md:contents">
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">From date</Label>
              <Input
                type="date"
                className="h-10 text-xs"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">To date</Label>
              <Input
                type="date"
                className="h-10 text-xs"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <label className="flex h-10 items-center gap-2 text-xs">
            <Checkbox
              checked={flaggedOnly}
              onCheckedChange={(v) => setFlaggedOnly(Boolean(v))}
            />
            Flagged / missing proof only
          </label>
        </div>
      </FilterBar>

      {reviewing && reviewable && (
        <Card className="shadow-none">
          <CardContent className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">
              Review shift mileage · {reviewing.truck.registration} (
              {reviewing.driver.name})
            </h2>
            <form
              onSubmit={(e) => void handleReview(e)}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label htmlFor="rev-start">Start odometer (km)</Label>
                <Input
                  id="rev-start"
                  inputMode="decimal"
                  value={startKm}
                  onChange={(e) => setStartKm(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rev-end">End odometer (km)</Label>
                <Input
                  id="rev-end"
                  inputMode="decimal"
                  value={endKm}
                  onChange={(e) => setEndKm(e.target.value)}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="rev-reason">Audit reason</Label>
                <Input
                  id="rev-reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Verified reading against photo / driver confirmation"
                />
              </div>
              <label className="flex items-center gap-2 text-xs sm:col-span-2">
                <Checkbox
                  checked={clearPhotos}
                  onCheckedChange={(v) => setClearPhotos(Boolean(v))}
                />
                Acknowledge missing photo exception
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save review"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReviewing(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        {shiftsQuery.isPending ? (
          <ListRowsSkeleton rows={4} />
        ) : !shifts.length ? (
          <EmptyState
            icon="clock"
            title="No driving shifts found"
            description="When drivers confirm a vehicle with start and end odometer readings, their mileage logs appear here."
          />
        ) : (
          <ul className="divide-y">
            {shifts.map((shift) => (
              <li key={shift.id} className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-start @2xl:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        {shift.truck.registration} · {shift.truck.identifier}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {shift.driver.name} · {shift.confirmedDate}
                      </span>
                      {!shift.endedAt ? (
                        <Badge>Active shift</Badge>
                      ) : shift.distanceKm != null ? (
                        <Badge variant="secondary">
                          {shift.distanceKm.toLocaleString("en-ZA")} km
                        </Badge>
                      ) : (
                        <Badge variant="outline">Distance unavailable</Badge>
                      )}
                      {shift.mileageReviewedAt && (
                        <Badge variant="outline">Reviewed</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Start: {new Date(shift.startedAt).toLocaleString()} (
                      {shift.startOdometerKm != null
                        ? `${Number(shift.startOdometerKm).toLocaleString("en-ZA")} km`
                        : "Not recorded"}
                      ) · End:{" "}
                      {shift.endedAt
                        ? `${new Date(shift.endedAt).toLocaleString()} (${shift.endOdometerKm != null ? `${Number(shift.endOdometerKm).toLocaleString("en-ZA")} km` : "Not recorded"})`
                        : "Still driving"}
                    </p>
                    {shift.mileageFlags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {shift.mileageFlags.map((f) => (
                          <Badge key={f} variant="destructive" className="text-[11px]">
                            {flagLabels[f] ?? f}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {(shift.startOdometerMissingPhotoReason ||
                      shift.endOdometerMissingPhotoReason ||
                      shift.endOdometerLowerReason ||
                      shift.mileageReviewNote) && (
                      <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                        {shift.startOdometerMissingPhotoReason && (
                          <p>
                            Start photo note:{" "}
                            {shift.startOdometerMissingPhotoReason}
                          </p>
                        )}
                        {shift.endOdometerMissingPhotoReason && (
                          <p>
                            End photo note: {shift.endOdometerMissingPhotoReason}
                          </p>
                        )}
                        {shift.endOdometerLowerReason && (
                          <p>
                            Lower reading reason: {shift.endOdometerLowerReason}
                          </p>
                        )}
                        {shift.mileageReviewNote && (
                          <p>
                            Reviewed by {shift.mileageReviewedByName}:{" "}
                            {shift.mileageReviewNote}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {reviewable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openReview(shift)}
                    >
                      Review / edit km
                    </Button>
                  )}
                </div>

                {(shift.startPhoto || shift.endPhoto) && (
                  <div className="flex flex-wrap gap-4 pt-1">
                    {shift.startPhoto && (
                      <a
                        href={attachmentUrl(shift.startPhoto.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="space-y-1 text-xs"
                      >
                        <img
                          src={attachmentUrl(shift.startPhoto.id)}
                          alt="Start odometer"
                          className="h-24 w-36 rounded-lg border object-cover"
                        />
                        <p className="text-muted-foreground">Start odometer</p>
                      </a>
                    )}
                    {shift.endPhoto && (
                      <a
                        href={attachmentUrl(shift.endPhoto.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="space-y-1 text-xs"
                      >
                        <img
                          src={attachmentUrl(shift.endPhoto.id)}
                          alt="End odometer"
                          className="h-24 w-36 rounded-lg border object-cover"
                        />
                        <p className="text-muted-foreground">End odometer</p>
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
