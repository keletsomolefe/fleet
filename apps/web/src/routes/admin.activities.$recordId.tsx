import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BackLink, PageHeader } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { DetailPageSkeleton } from "@/components/page-skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import {
  activityKindLabels,
  attachmentUrl,
  expenseCategoryLabels,
  flagLabels,
  formatZar,
  getActivityDetail,
  getTransportCatalogue,
  reviewActivityRecord,
  reviewStatusLabels,
  uploadTransportAttachment,
  type ActivityDataDto,
  type ReviewStatus,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/activities/$recordId")({
  loader: async ({ context, params }) => {
    if (!can(context.session, "activities.read")) return;
    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "transport-record",
          params.recordId,
        ],
        queryFn: () => getActivityDetail(params.recordId),
      }),
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "transport-catalogue",
        ],
        queryFn: getTransportCatalogue,
      }),
    ]);
  },
  component: ActivityDetailPage,
});

function ActivityDetailPage() {
  const { recordId } = Route.useParams();
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "activities.read");
  const reviewable = can(session, "activities.review");
  const canReprice = can(session, "pricing.write");
  const showMoney = can(session, "revenue.read");

  const detailQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "transport-record",
      recordId,
    ],
    queryFn: () => getActivityDetail(recordId),
    enabled: readable,
  });

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const [draft, setDraft] = useState<ActivityDataDto | null>(null);
  const [decision, setDecision] = useState<ReviewStatus>("validated");
  const [reason, setReason] = useState("");
  const [reprice, setReprice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (detailQuery.data?.record) {
      setDraft(structuredClone(detailQuery.data.record.data));
      setDecision(
        detailQuery.data.record.review === "pending"
          ? "validated"
          : detailQuery.data.record.review,
      );
    }
  }, [detailQuery.data?.record]);

  if (!readable) {
    return <PageError message="You do not have access to Driver activity." />;
  }
  if (detailQuery.isPending) {
    return (
      <>
        <PageHeader
          title="Activity review"
          back={<BackLink to="/admin/activities">Driver activity</BackLink>}
        />
        <DetailPageSkeleton columns={3} />
      </>
    );
  }
  if (detailQuery.error || !detailQuery.data) {
    return (
      <>
        <PageHeader
          title="Activity review"
          back={<BackLink to="/admin/activities">Driver activity</BackLink>}
        />
        <PageError
          message={detailQuery.error?.message ?? "Activity record not found."}
        />
      </>
    );
  }

  const { record, revisions, attachments, audits, charge } = detailQuery.data;
  const customers = catalogueQuery.data?.customers ?? [];
  const products = catalogueQuery.data?.products ?? [];
  const locations = catalogueQuery.data?.locations ?? [];

  async function handleReview(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      await reviewActivityRecord(session.csrfToken, record.id, {
        version: record.version,
        action: decision,
        reason,
        data: draft,
        reprice: canReprice && reprice,
      });
      setReason("");
      setReprice(false);
      setStatusMessage("Review saved and audited.");
      await refreshAdminOperations(queryClient, session.user.id);
      await detailQuery.refetch();
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save review.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setFormError("");
    try {
      const defaultKind =
        record.kind === "fuel"
          ? "fuel_receipt"
          : record.kind === "expense"
            ? "expense_receipt"
            : record.kind === "collection"
              ? "weighbridge_ticket"
              : "pod";
      await uploadTransportAttachment(
        session.csrfToken,
        "record",
        record.id,
        file,
        defaultKind,
      );
      setStatusMessage("Photo uploaded.");
      await detailQuery.refetch();
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not upload photo.",
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <>
      <PageHeader
        title={`${activityKindLabels[record.kind]} · ${record.registration}`}
        group="Operations"
        description={`${record.driverName} · ${new Date(record.occurredAt).toLocaleString()} · Version ${record.version}`}
        back={<BackLink to="/admin/activities">Driver activity</BackLink>}
      />

      {statusMessage && (
        <Alert role="status">
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}
      {formError && <PageError message={formError} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Operational details</CardTitle>
              <Badge
                variant={
                  record.review === "validated"
                    ? "default"
                    : record.review === "clarification"
                      ? "destructive"
                      : "outline"
                }
              >
                {reviewStatusLabels[record.review]}
              </Badge>
              {showMoney && charge && (
                <Badge variant="secondary">
                  {charge.status === "priced"
                    ? formatZar(charge.amount)
                    : charge.status === "uncharged"
                      ? "Uncharged"
                      : "Needs rate"}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {record.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {record.flags.map((f) => (
                  <Badge key={f} variant="destructive">
                    {flagLabels[f] ?? f}
                  </Badge>
                ))}
              </div>
            )}

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Driver & vehicle</dt>
                <dd className="font-medium">
                  {record.driverName} · {record.registration} ({record.truckIdentifier})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Odometer / GPS</dt>
                <dd>
                  {record.data.odometerKm ? `${record.data.odometerKm} km` : "—"}
                  {record.data.latitude != null && record.data.longitude != null
                    ? ` · ${record.data.latitude.toFixed(5)}, ${record.data.longitude.toFixed(5)}`
                    : ""}
                </dd>
              </div>
              {(record.kind === "collection" || record.kind === "delivery") && (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">Customer & product</dt>
                    <dd className="font-medium">
                      {record.data.customer.name || "Not matched"} ·{" "}
                      {record.data.product.name || "Not matched"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Quantity & ref</dt>
                    <dd>
                      {record.data.quantity ?? "?"} {record.data.unit}
                      {record.data.collectedQuantity
                        ? ` (collected: ${record.data.collectedQuantity})`
                        : ""}
                      {record.data.waybillNumber
                        ? ` · POD/Waybill: ${record.data.waybillNumber}`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Collection site</dt>
                    <dd>{record.data.origin.name || "Not recorded"}</dd>
                  </div>
                  {record.kind === "delivery" && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Delivery site</dt>
                      <dd>{record.data.destination.name || "Not recorded"}</dd>
                    </div>
                  )}
                </>
              )}
              {record.kind === "fuel" && (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">Fuel litres & cost</dt>
                    <dd className="font-medium">
                      {record.data.fuelLitres ?? "?"} L ·{" "}
                      {formatZar(record.data.fuelTotalCost)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Station & receipt</dt>
                    <dd>
                      {record.data.fuelStation || "—"}
                      {record.data.receiptNumber
                        ? ` · #${record.data.receiptNumber}`
                        : ""}
                    </dd>
                  </div>
                </>
              )}
              {record.kind === "expense" && (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">Category & amount</dt>
                    <dd className="font-medium">
                      {expenseCategoryLabels[record.data.expenseCategory ?? "other"]}{" "}
                      · {formatZar(record.data.expenseAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Vendor & receipt</dt>
                    <dd>
                      {record.data.vendorName || "—"}
                      {record.data.receiptNumber
                        ? ` · #${record.data.receiptNumber}`
                        : ""}
                    </dd>
                  </div>
                </>
              )}
              {record.data.note && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Driver notes</dt>
                  <dd>{record.data.note}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              Proof photos ({attachments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No POD, weighbridge or receipt photos attached yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {attachments.map((att) => (
                  <a
                    key={att.id}
                    href={attachmentUrl(att.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="space-y-1 text-xs"
                  >
                    <img
                      src={attachmentUrl(att.id)}
                      alt={att.kind}
                      className="h-28 w-full rounded-lg border object-cover"
                    />
                    <p className="truncate text-muted-foreground">
                      {att.kind.replace(/_/g, " ")}
                    </p>
                  </a>
                ))}
              </div>
            )}
            {reviewable && (
              <div className="space-y-1 pt-2">
                <Label htmlFor="upload-proof" className="text-xs">
                  Add photo (POD / receipt)
                </Label>
                <Input
                  id="upload-proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(e) => void handlePhotoUpload(e)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {reviewable && draft && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Office review & catalogue matching</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleReview(e)} className="grid gap-4 sm:grid-cols-2">
              {(record.kind === "collection" || record.kind === "delivery") && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Match customer</Label>
                    <select
                      className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                      value={draft.customer.id ?? ""}
                      onChange={(e) => {
                        const c = customers.find((x) => x.id === e.target.value);
                        setDraft({
                          ...draft,
                          customer: {
                            id: c?.id ?? null,
                            name: c?.name ?? draft.customer.name,
                          },
                        });
                      }}
                    >
                      <option value="">Unmatched ({draft.customer.name || "none"})</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Match product</Label>
                    <select
                      className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                      value={draft.product.id ?? ""}
                      onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value);
                        setDraft({
                          ...draft,
                          product: {
                            id: p?.id ?? null,
                            name: p?.name ?? draft.product.name,
                          },
                        });
                      }}
                    >
                      <option value="">Unmatched ({draft.product.name || "none"})</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Match collection site</Label>
                    <select
                      className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                      value={draft.origin.id ?? ""}
                      onChange={(e) => {
                        const l = locations.find((x) => x.id === e.target.value);
                        setDraft({
                          ...draft,
                          origin: {
                            id: l?.id ?? null,
                            name: l?.name ?? draft.origin.name,
                          },
                        });
                      }}
                    >
                      <option value="">Unmatched ({draft.origin.name || "none"})</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {record.kind === "delivery" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Match delivery site</Label>
                      <select
                        className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                        value={draft.destination.id ?? ""}
                        onChange={(e) => {
                          const l = locations.find((x) => x.id === e.target.value);
                          setDraft({
                            ...draft,
                            destination: {
                              id: l?.id ?? null,
                              name: l?.name ?? draft.destination.name,
                            },
                          });
                        }}
                      >
                        <option value="">
                          Unmatched ({draft.destination.name || "none"})
                        </option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Actual quantity ({draft.unit})</Label>
                    <Input
                      className="h-10 text-xs"
                      inputMode="decimal"
                      value={draft.quantity ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, quantity: e.target.value || null })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Waybill / POD / Weighbridge #</Label>
                    <Input
                      className="h-10 text-xs"
                      value={draft.waybillNumber}
                      onChange={(e) =>
                        setDraft({ ...draft, waybillNumber: e.target.value })
                      }
                    />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Decision</Label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as ReviewStatus)}
                >
                  <option value="validated">Validate</option>
                  <option value="clarification">Request clarification</option>
                  <option value="pending">Keep pending</option>
                  <option value="void">Void record</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Audit reason (required)</Label>
                <Input
                  required
                  className="h-10 text-xs"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Verified against signed POD / weighbridge slip"
                />
              </div>

              {canReprice && record.kind === "delivery" && (
                <label className="flex items-center gap-2 text-xs sm:col-span-2">
                  <Checkbox
                    checked={reprice}
                    onCheckedChange={(v) => setReprice(Boolean(v))}
                  />
                  Recalculate rate snapshot using latest applicable rate
                </label>
              )}

              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving review…" : "Submit review"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              Driver submissions ({revisions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {revisions.map((rev, idx) => (
              <div key={rev.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    Revision #{idx + 1} (base v{rev.baseVersion})
                  </span>
                  {rev.conflict && <Badge variant="destructive">Conflict</Badge>}
                </div>
                <p className="text-muted-foreground">
                  Received {new Date(rev.receivedAt).toLocaleString()}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              Office audit log ({audits.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {audits.length === 0 ? (
              <p className="text-muted-foreground">No office actions yet.</p>
            ) : (
              audits.map((a) => (
                <div key={a.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">
                      {a.action.replace(/_/g, " ")} · {a.actorName}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="pt-1 text-muted-foreground">{a.reason}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
