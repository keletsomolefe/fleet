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
  type CustomerDto,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/customers")({
  loader: async ({ context }) => {
    if (!can(context.session, "customers.read")) return;
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
  component: CustomersPage,
});

function CustomersPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "customers.read");
  const writable = can(session, "customers.write");

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<CustomerDto | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  // Customer-product linking state
  const [linkingCustomerId, setLinkingCustomerId] = useState<string | null>(
    null,
  );
  const [linkProductId, setLinkProductId] = useState("");
  const [linkSupplies, setLinkSupplies] = useState(false);
  const [linkReceives, setLinkReceives] = useState(true);

  if (!readable) {
    return <PageError message="You do not have access to Customers." />;
  }

  function openNew() {
    setEditing(null);
    setName("");
    setIndustry("");
    setContact("");
    setEmail("");
    setPhone("");
    setNotes("");
    setActive(true);
    setFormError("");
    setShowForm(true);
  }

  function openEdit(customer: CustomerDto) {
    setEditing(customer);
    setName(customer.name);
    setIndustry(customer.industry);
    setContact(customer.contact);
    setEmail(customer.email);
    setPhone(customer.phone);
    setNotes(customer.notes);
    setActive(customer.active);
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
        "customers",
        {
          name,
          industry,
          contact,
          email,
          phone,
          notes,
          active,
          ...(editing ? { version: editing.version } : {}),
        },
        editing?.id,
      );
      setShowForm(false);
      setEditing(null);
      setStatusMessage(editing ? "Customer updated." : "Customer added.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save customer.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveLink(event: React.FormEvent) {
    event.preventDefault();
    if (!linkingCustomerId || !linkProductId) return;
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      await saveMaster(session.csrfToken, "customer-products", {
        customerId: linkingCustomerId,
        productId: linkProductId,
        supplies: linkSupplies,
        receives: linkReceives,
        active: true,
      });
      setLinkingCustomerId(null);
      setLinkProductId("");
      setStatusMessage("Customer product link saved.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not link product.",
      );
    } finally {
      setBusy(false);
    }
  }

  const productsById = new Map(
    (data?.products ?? []).map((p) => [p.id, p]),
  );
  const linksByCustomer = new Map<
    string,
    Array<{ id: string; productName: string; supplies: boolean; receives: boolean }>
  >();
  for (const cp of data?.customerProducts ?? []) {
    if (!cp.active) continue;
    const product = productsById.get(cp.productId);
    if (!product) continue;
    const list = linksByCustomer.get(cp.customerId) ?? [];
    list.push({
      id: cp.id,
      productName: product.name,
      supplies: cp.supplies,
      receives: cp.receives,
    });
    linksByCustomer.set(cp.customerId, list);
  }

  const filtered = (data?.customers ?? []).filter((c) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return (
      c.name.toLowerCase().includes(term) ||
      c.industry.toLowerCase().includes(term) ||
      c.contact.toLowerCase().includes(term)
    );
  });

  return (
    <>
      <PageHeader
        title="Customers"
        group="Customers & rates"
        description="Companies you haul for, what they deal in, and which products they supply or receive."
        actions={
          <>
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
            {writable && (
              <CreateAction onClick={openNew}>
                <Plus /> Add customer
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
              {editing ? `Edit ${editing.name}` : "Add customer"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSave(e)} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cust-name">Company name</Label>
                <Input
                  id="cust-name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Highveld Chrome"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-industry">What they deal in (industry / sector)</Label>
                <Input
                  id="cust-industry"
                  maxLength={120}
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. Mining, Grain & Agriculture, Aggregates"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-contact">Primary contact</Label>
                <Input
                  id="cust-contact"
                  maxLength={200}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-phone">Phone</Label>
                <Input
                  id="cust-phone"
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-email">Email</Label>
                <Input
                  id="cust-email"
                  type="email"
                  maxLength={200}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-notes">Notes</Label>
                <Input
                  id="cust-notes"
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {editing && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Checkbox
                    checked={active}
                    onCheckedChange={(v) => setActive(Boolean(v))}
                  />
                  Active customer
                </label>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save customer"}
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

      {linkingCustomerId && writable && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              Link product to{" "}
              {data?.customers.find((c) => c.id === linkingCustomerId)?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSaveLink(e)} className="grid gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="link-product">Product</Label>
                <select
                  id="link-product"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={linkProductId}
                  onChange={(e) => setLinkProductId(e.target.value)}
                >
                  <option value="">Choose a product…</option>
                  {(data?.products ?? [])
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unit})
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex flex-col justify-center gap-2 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={linkSupplies}
                    onCheckedChange={(v) => setLinkSupplies(Boolean(v))}
                  />
                  Supplies this product (collection)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={linkReceives}
                    onCheckedChange={(v) => setLinkReceives(Boolean(v))}
                  />
                  Receives this product (delivery)
                </label>
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={busy || !linkProductId}>
                  Save link
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLinkingCustomerId(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="border-b p-4 sm:p-5">
          <Input
            aria-label="Search customers"
            placeholder="Search by customer, industry or contact"
            className="max-w-md"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {isPending ? (
          <ListRowsSkeleton rows={4} />
        ) : !filtered.length ? (
          <EmptyState
            icon="users"
            title={q ? "No matching customers" : "No customers yet"}
            description="Add customers and link the products they supply or receive to set up transport rates."
          />
        ) : (
          <ul className="divide-y">
            {filtered.map((customer) => {
              const links = linksByCustomer.get(customer.id) ?? [];
              return (
                <li
                  key={customer.id}
                  className="flex flex-col gap-3 p-4 @2xl:flex-row @2xl:items-start @2xl:justify-between sm:px-5"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{customer.name}</p>
                      {customer.industry && (
                        <Badge variant="secondary">{customer.industry}</Badge>
                      )}
                      {!customer.active && (
                        <Badge variant="outline">Archived</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[customer.contact, customer.phone, customer.email]
                        .filter(Boolean)
                        .join(" · ") || "No contact details recorded"}
                    </p>
                    {links.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {links.map((link) => (
                          <Badge key={link.id} variant="outline" className="text-[11px]">
                            {link.productName} ·{" "}
                            {link.supplies && link.receives
                              ? "Supplies & receives"
                              : link.supplies
                                ? "Supplies"
                                : "Receives"}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {writable && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setLinkingCustomerId(customer.id);
                          setLinkProductId("");
                          setLinkSupplies(false);
                          setLinkReceives(true);
                          setFormError("");
                        }}
                      >
                        Link product
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(customer)}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
