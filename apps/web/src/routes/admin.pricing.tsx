import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader, CreateAction } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
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
  createTransportRate,
  currentOperationalDate,
  endTransportRate,
  formatZar,
  getTransportCatalogue,
  getTransportRates,
  unitLabels,
  type Unit,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/pricing")({
  loader: async ({ context }) => {
    if (!can(context.session, "pricing.read")) return;
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
          "transport-rates",
        ],
        queryFn: getTransportRates,
      }),
    ]);
  },
  component: PricingPage,
});

function PricingPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "pricing.read");
  const writable = can(session, "pricing.write");

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });
  const ratesQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-rates"],
    queryFn: getTransportRates,
    enabled: readable,
  });

  const [showForm, setShowForm] = useState(false);
  const [customerProductId, setCustomerProductId] = useState("");
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [method, setMethod] = useState<"quantity" | "delivery">("quantity");
  const [basis, setBasis] = useState<"collected" | "delivered">("delivered");
  const [unit, setUnit] = useState<Unit>("tonne");
  const [price, setPrice] = useState("");
  const [startsOn, setStartsOn] = useState(currentOperationalDate());
  const [endsOn, setEndsOn] = useState("");
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endDateInput, setEndDateInput] = useState(currentOperationalDate());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  if (!readable) {
    return <PageError message="You do not have access to Transport rates." />;
  }

  const customersById = new Map(
    (catalogueQuery.data?.customers ?? []).map((c) => [c.id, c.name]),
  );
  const productsById = new Map(
    (catalogueQuery.data?.products ?? []).map((p) => [p.id, p]),
  );
  const locationsById = new Map(
    (catalogueQuery.data?.locations ?? []).map((l) => [l.id, l.name]),
  );
  const cpLabel = (cpId: string) => {
    const cp = catalogueQuery.data?.customerProducts.find((x) => x.id === cpId);
    if (!cp) return cpId;
    const cName = customersById.get(cp.customerId) ?? cp.customerId;
    const pName = productsById.get(cp.productId)?.name ?? cp.productId;
    return `${cName} · ${pName}`;
  };

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      await createTransportRate(session.csrfToken, {
        customerProductId,
        originId: originId || null,
        destinationId: destinationId || null,
        method,
        basis,
        unit,
        price,
        startsOn,
        endsOn: endsOn || null,
      });
      setShowForm(false);
      setPrice("");
      setEndsOn("");
      setStatusMessage("Transport rate saved.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save rate.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleEndRate(rateId: string) {
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      await endTransportRate(session.csrfToken, rateId, endDateInput);
      setEndingId(null);
      setStatusMessage("Rate end date updated.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not end rate.",
      );
    } finally {
      setBusy(false);
    }
  }

  const rates = ratesQuery.data ?? [];
  const activeLinks = (catalogueQuery.data?.customerProducts ?? []).filter(
    (cp) => cp.active,
  );
  const activeLocations = (catalogueQuery.data?.locations ?? []).filter(
    (l) => l.active,
  );

  return (
    <>
      <PageHeader
        title="Transport rates"
        group="Customers & rates"
        description="Effective-dated ZAR pricing per tonne, unit or delivery. Exact routes override default rates."
        actions={
          <>
            <RefreshButton
              busy={ratesQuery.isFetching}
              onRefresh={() => void ratesQuery.refetch()}
            />
            {writable && (
              <CreateAction onClick={() => setShowForm((v) => !v)}>
                <Plus /> Add rate
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
      {(ratesQuery.error || catalogueQuery.error) && (
        <PageError
          message={(ratesQuery.error ?? catalogueQuery.error)?.message ?? "Failed to load rates."}
        />
      )}
      {formError && <PageError message={formError} />}

      {showForm && writable && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Add transport rate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleCreate(e)} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rate-cp">Customer & product</Label>
                <select
                  id="rate-cp"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={customerProductId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCustomerProductId(id);
                    const cp = activeLinks.find((x) => x.id === id);
                    const prod = cp ? productsById.get(cp.productId) : null;
                    if (prod) setUnit(prod.unit);
                  }}
                >
                  <option value="">Choose customer & product…</option>
                  {activeLinks.map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cpLabel(cp.id)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-origin">Collection site (optional route)</Label>
                <select
                  id="rate-origin"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={originId}
                  onChange={(e) => setOriginId(e.target.value)}
                >
                  <option value="">Any site (default rate)</option>
                  {activeLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-dest">Delivery site (optional route)</Label>
                <select
                  id="rate-dest"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                >
                  <option value="">Any site (default rate)</option>
                  {activeLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-method">Pricing method</Label>
                <select
                  id="rate-method"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={method}
                  onChange={(e) =>
                    setMethod(e.target.value as "quantity" | "delivery")
                  }
                >
                  <option value="quantity">Per unit (e.g. per tonne)</option>
                  <option value="delivery">Fixed per delivery</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-basis">Quantity basis</Label>
                <select
                  id="rate-basis"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={basis}
                  onChange={(e) =>
                    setBasis(e.target.value as "collected" | "delivered")
                  }
                >
                  <option value="delivered">Delivered quantity</option>
                  <option value="collected">Collected quantity</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-unit">Unit</Label>
                <select
                  id="rate-unit"
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
              <div className="space-y-1.5">
                <Label htmlFor="rate-price">Price (ZAR)</Label>
                <Input
                  id="rate-price"
                  required
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="e.g. 185.50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-start">Starts on</Label>
                <Input
                  id="rate-start"
                  type="date"
                  required
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate-end">Ends on (optional)</Label>
                <Input
                  id="rate-end"
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save rate"}
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
        {ratesQuery.isPending ? (
          <ListRowsSkeleton rows={4} />
        ) : !rates.length ? (
          <EmptyState
            icon="document"
            title="No transport rates yet"
            description="Link a product to a customer first, then add an effective-dated ZAR rate to calculate month-end revenue automatically."
          />
        ) : (
          <ul className="divide-y">
            {rates.map((rate) => (
              <li
                key={rate.id}
                className="flex flex-col gap-3 p-4 @2xl:flex-row @2xl:items-center @2xl:justify-between sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{cpLabel(rate.customerProductId)}</p>
                    <Badge variant="secondary">
                      {formatZar(rate.price)}{" "}
                      {rate.method === "delivery"
                        ? "/ delivery"
                        : `/ ${rate.unit} (${rate.basis})`}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rate.originId && rate.destinationId
                      ? `${locationsById.get(rate.originId) ?? "Origin"} → ${locationsById.get(rate.destinationId) ?? "Destination"}`
                      : "Default rate (all routes)"}{" "}
                    · Effective {rate.startsOn}
                    {rate.endsOn ? ` to ${rate.endsOn}` : " onwards"}
                  </p>
                </div>
                {writable && (
                  <div className="flex flex-wrap items-center gap-2">
                    {endingId === rate.id ? (
                      <>
                        <Input
                          type="date"
                          className="h-9 w-40"
                          value={endDateInput}
                          onChange={(e) => setEndDateInput(e.target.value)}
                        />
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void handleEndRate(rate.id)}
                        >
                          Save end date
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEndingId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEndingId(rate.id);
                          setEndDateInput(
                            rate.endsOn ?? currentOperationalDate(),
                          );
                        }}
                      >
                        {rate.endsOn ? "Change end date" : "End rate"}
                      </Button>
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
