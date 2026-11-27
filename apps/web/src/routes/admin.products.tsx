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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import {
  getTransportCatalogue,
  saveMaster,
  unitLabels,
  type ProductDto,
  type Unit,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/products")({
  loader: async ({ context }) => {
    if (!can(context.session, "products.read")) return;
    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "transport-catalogue",
        ],
        queryFn: getTransportCatalogue,
      }),
    ]);
  },
  component: ProductsPage,
});

function ProductsPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "products.read");
  const writable = can(session, "products.write");

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("tonne");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  if (!readable) {
    return <PageError message="You do not have access to Products." />;
  }

  function openNew() {
    setEditing(null);
    setName("");
    setUnit("tonne");
    setActive(true);
    setFormError("");
    setShowForm(true);
  }

  function openEdit(product: ProductDto) {
    setEditing(product);
    setName(product.name);
    setUnit(product.unit);
    setActive(product.active);
    setFormError("");
    setShowForm(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      await saveMaster(
        session.csrfToken,
        "products",
        {
          name,
          unit,
          active,
          ...(editing ? { version: editing.version } : {}),
        },
        editing?.id,
      );
      setShowForm(false);
      setEditing(null);
      setStatusMessage(editing ? "Product updated." : "Product added.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save product.",
      );
    } finally {
      setBusy(false);
    }
  }

  const products = data?.products ?? [];

  return (
    <>
      <PageHeader
        title="Products"
        group="Customers & rates"
        description="Commodities and cargo types moved by your fleet."
        actions={
          <>
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
            {writable && (
              <CreateAction onClick={openNew}>
                <Plus /> Add product
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
      {error && <PageError message={error.message} />}
      {formError && <PageError message={formError} />}

      {showForm && writable && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              {editing ? `Edit ${editing.name}` : "Add product"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSave(e)} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prod-name">Product name</Label>
                <Input
                  id="prod-name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Chrome ore, Coal, Maize, River sand"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-unit">Default unit</Label>
                <select
                  id="prod-unit"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as Unit)}
                >
                  {(Object.keys(unitLabels) as Unit[]).map((key) => (
                    <option key={key} value={key}>
                      {unitLabels[key]}
                    </option>
                  ))}
                </select>
              </div>
              {editing && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Checkbox
                    checked={active}
                    onCheckedChange={(v) => setActive(Boolean(v))}
                  />
                  Active product
                </label>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save product"}
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
        {isPending ? (
          <ListRowsSkeleton rows={4} withBadges={false} />
        ) : !products.length ? (
          <EmptyState
            icon="document"
            title="No products yet"
            description="Add the products your vehicles haul (e.g. tonnes of coal, chrome, maize, or sand)."
          />
        ) : (
          <ul className="divide-y">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between gap-4 p-4 sm:px-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{product.name}</p>
                  <Badge variant="secondary">{unitLabels[product.unit]}</Badge>
                  {!product.active && <Badge variant="outline">Archived</Badge>}
                </div>
                {writable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(product)}
                  >
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
