import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader, CreateAction } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
import { ExportMenu } from "@/components/export-menu";
import { RefreshButton } from "@/components/refresh-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import {
  currentOperationalDate,
  getDispatches,
  getTransportCatalogue,
  saveDispatch,
  unitLabels,
  type DispatchDto,
  type Unit,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/dispatch")({
  loader: async ({ context }) => {
    if (!can(context.session, "dispatch.read")) return;
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
          "transport-dispatches",
        ],
        queryFn: getDispatches,
      }),
    ]);
  },
  component: DispatchPage,
});

type StopDraft = {
  id: string;
  destinationId: string;
  receiverId: string;
  quantity: string;
  collectedQuantity: string;
};

function newStop(): StopDraft {
  return {
    id: crypto.randomUUID(),
    destinationId: "",
    receiverId: "",
    quantity: "",
    collectedQuantity: "",
  };
}

function DispatchPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "dispatch.read");
  const writable = can(session, "dispatch.write");

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });
  const dispatchQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-dispatches"],
    queryFn: getDispatches,
    enabled: readable,
    refetchInterval: 20_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(currentOperationalDate());
  const [reference, setReference] = useState("");
  const [driverId, setDriverId] = useState("");
  const [truckId, setTruckId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [originId, setOriginId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<Unit>("tonne");
  const [instructions, setInstructions] = useState("");
  const [stops, setStops] = useState<StopDraft[]>([newStop()]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  if (!readable) {
    return <PageError message="You do not have access to Dispatch." />;
  }

  const customers = (catalogueQuery.data?.customers ?? []).filter((c) => c.active);
  const products = (catalogueQuery.data?.products ?? []).filter((p) => p.active);
  const locations = (catalogueQuery.data?.locations ?? []).filter((l) => l.active);
  const drivers = dispatchQuery.data?.drivers ?? [];
  const trucks = dispatchQuery.data?.trucks ?? [];

  const driverName = (id: string) =>
    drivers.find((d) => d.id === id)?.name ?? id;
  const truckLabel = (id: string) => {
    const t = trucks.find((x) => x.id === id);
    return t ? `${t.registration} · ${t.identifier}` : id;
  };

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      const cust = customers.find((c) => c.id === customerId);
      const sup = customers.find((c) => c.id === supplierId);
      const prod = products.find((p) => p.id === productId);
      const orig = locations.find((l) => l.id === originId);
      await saveDispatch(session.csrfToken, {
        reference: reference.trim() || null,
        date,
        driverId,
        truckId,
        status: "dispatched",
        plan: {
          customer: { id: cust?.id ?? null, name: cust?.name ?? "" },
          supplier: { id: sup?.id ?? null, name: sup?.name ?? "" },
          product: { id: prod?.id ?? null, name: prod?.name ?? "" },
          origin: { id: orig?.id ?? null, name: orig?.name ?? "" },
          quantity,
          unit,
          instructions,
          collectionId: crypto.randomUUID(),
          deliveries: stops.map((s) => {
            const dest = locations.find((l) => l.id === s.destinationId);
            const rec = customers.find((c) => c.id === s.receiverId);
            return {
              id: s.id,
              destination: { id: dest?.id ?? null, name: dest?.name ?? "" },
              receiver: { id: rec?.id ?? null, name: rec?.name ?? "" },
              quantity: s.quantity || quantity,
              collectedQuantity: s.collectedQuantity || null,
            };
          }),
        },
      });
      setShowForm(false);
      setReference("");
      setQuantity("");
      setInstructions("");
      setStops([newStop()]);
      setStatusMessage("Load dispatched to driver.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save dispatch.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(
    dispatch: DispatchDto,
    status: "completed" | "cancelled",
  ) {
    setBusy(true);
    setFormError("");
    try {
      await saveDispatch(
        session.csrfToken,
        {
          reference: dispatch.reference,
          date: dispatch.date,
          driverId: dispatch.driverId,
          truckId: dispatch.truckId,
          status,
          version: dispatch.version,
          plan: dispatch.plan,
        },
        dispatch.id,
      );
      setStatusMessage(
        status === "completed" ? "Dispatch marked completed." : "Dispatch cancelled.",
      );
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not update dispatch.",
      );
    } finally {
      setBusy(false);
    }
  }

  const items = dispatchQuery.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Dispatch"
        group="Operations"
        description="Assign pickup and drop-off loads to drivers. Dispatched loads download straight to the driver app."
        actions={
          <>
            <RefreshButton
              busy={dispatchQuery.isFetching}
              onRefresh={() => void dispatchQuery.refetch()}
            />
            <ExportMenu dataset="dispatches" />
            {writable && (
              <CreateAction onClick={() => setShowForm((v) => !v)}>
                <Plus /> New dispatch
              </CreateAction>
            )}
          </>
        }
      />

      {statusMessage && (
        <Alert role="status">
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}
      {dispatchQuery.error && <PageError message={dispatchQuery.error.message} />}
      {formError && <PageError message={formError} />}

      {showForm && writable && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Plan & dispatch a load</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSave(e)} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dsp-date">Date</Label>
                <Input
                  id="dsp-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-ref">Reference (auto-generated if blank)</Label>
                <Input
                  id="dsp-ref"
                  maxLength={80}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. DSP-261125-01"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-driver">Driver</Label>
                <select
                  id="dsp-driver"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                >
                  <option value="">Choose driver…</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.identifier})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-truck">Vehicle</Label>
                <select
                  id="dsp-truck"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={truckId}
                  onChange={(e) => setTruckId(e.target.value)}
                >
                  <option value="">Choose vehicle…</option>
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.registration} · {t.identifier}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-cust">Paying customer</Label>
                <select
                  id="dsp-cust"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Choose customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-prod">Product</Label>
                <select
                  id="dsp-prod"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    const p = products.find((x) => x.id === e.target.value);
                    if (p) setUnit(p.unit);
                  }}
                >
                  <option value="">Choose product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unit})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-origin">Collection / pickup site</Label>
                <select
                  id="dsp-origin"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={originId}
                  onChange={(e) => setOriginId(e.target.value)}
                >
                  <option value="">Choose pickup site…</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-supplier">Supplier (optional)</Label>
                <select
                  id="dsp-supplier"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">Same as customer / none</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-qty">Planned collection quantity</Label>
                <Input
                  id="dsp-qty"
                  required
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 34"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dsp-unit">Unit</Label>
                <select
                  id="dsp-unit"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as Unit)}
                >
                  {(Object.keys(unitLabels) as Unit[]).map((u) => (
                    <option key={u} value={u}>
                      {unitLabels[u]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Delivery stops ({stops.length})</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setStops((prev) => [...prev, newStop()])}
                  >
                    <Plus className="size-4" /> Add stop
                  </Button>
                </div>
                {stops.map((stop, idx) => (
                  <div
                    key={stop.id}
                    className="grid gap-3 rounded-xl border p-3 @md:grid-cols-2 @3xl:grid-cols-4"
                  >
                    <div className="space-y-1">
                      <Label className="text-xs">Drop-off site #{idx + 1}</Label>
                      <select
                        required
                        className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                        value={stop.destinationId}
                        onChange={(e) =>
                          setStops((prev) =>
                            prev.map((s) =>
                              s.id === stop.id
                                ? { ...s, destinationId: e.target.value }
                                : s,
                            ),
                          )
                        }
                      >
                        <option value="">Choose site…</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Receiver (optional)</Label>
                      <select
                        className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                        value={stop.receiverId}
                        onChange={(e) =>
                          setStops((prev) =>
                            prev.map((s) =>
                              s.id === stop.id
                                ? { ...s, receiverId: e.target.value }
                                : s,
                            ),
                          )
                        }
                      >
                        <option value="">Same as customer</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Planned qty ({unit})</Label>
                      <Input
                        className="h-10 text-xs"
                        inputMode="decimal"
                        placeholder={quantity || "34"}
                        value={stop.quantity}
                        onChange={(e) =>
                          setStops((prev) =>
                            prev.map((s) =>
                              s.id === stop.id
                                ? { ...s, quantity: e.target.value }
                                : s,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      {stops.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setStops((prev) =>
                              prev.filter((s) => s.id !== stop.id),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="dsp-inst">Driver instructions (optional)</Label>
                <Input
                  id="dsp-inst"
                  maxLength={2000}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Weighbridge gate, reference number, contact person"
                />
              </div>

              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Dispatching…" : "Dispatch load"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        {dispatchQuery.isPending ? (
          <ListRowsSkeleton rows={4} />
        ) : !items.length ? (
          <EmptyState
            icon="dispatch"
            title="No dispatches yet"
            description="Plan a pickup and delivery load here, or drivers can self-log ad-hoc loads directly on their phones."
          />
        ) : (
          <ul className="divide-y">
            {items.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-3 p-4 @2xl:flex-row @2xl:items-start @2xl:justify-between sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{d.reference}</p>
                    <Badge
                      variant={
                        d.status === "dispatched"
                          ? "default"
                          : d.status === "completed"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {d.status}
                    </Badge>
                    {d.allocationConflict && (
                      <Badge variant="destructive">Schedule conflict</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {d.date}
                    </span>
                  </div>
                  <p className="text-sm">
                    {d.plan.origin.name || "Origin"} →{" "}
                    {d.plan.deliveries
                      .map((stop) => stop.destination.name || "Destination")
                      .join(", ")}{" "}
                    ·{" "}
                    <span className="font-medium">
                      {d.plan.quantity} {d.plan.unit} {d.plan.product.name}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Customer: {d.plan.customer.name || "—"} · Driver:{" "}
                    {driverName(d.driverId)} · Vehicle: {truckLabel(d.truckId)}
                  </p>
                </div>
                {writable && d.status === "dispatched" && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void updateStatus(d, "completed")}
                    >
                      Mark complete
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void updateStatus(d, "cancelled")}
                    >
                      Cancel
                    </Button>
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
