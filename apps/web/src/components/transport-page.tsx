import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Combobox } from "@/components/ui/combobox";
import { type AdminSession, can } from "@/lib/auth";
import {
  transportRequest,
  type Json,
  type ActivityData,
  type Catalogue,
  type Entry,
  type Job,
  type RecordRow,
  type Ref,
  type TransportPageData,
} from "@/lib/transport";

const labels: Record<string, string> = {
  tonne: "Tonnes",
  kg: "Kilograms",
  litre: "Litres",
  m3: "Cubic metres",
  pallet: "Pallets",
  item: "Items",
  pending: "Awaiting review",
  validated: "Validated",
  clarification: "Clarification requested",
  void: "Voided",
  needs_pricing: "Needs pricing",
  priced: "Estimated",
  uncharged: "Uncharged",
};
const title = (value: string) =>
  labels[value] ??
  value.replaceAll("_", " ").replace(/^./, (x) => x.toUpperCase());
const money = (value: unknown) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    Number(value ?? 0),
  );
const emptyRef: Ref = { id: null, name: "" };
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid content-start gap-2 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}
function Select({
  value,
  onChange,
  values,
}: {
  value: string;
  onChange: (v: string) => void;
  values: string[];
}) {
  return (
    <select
      className="h-10 rounded-md border bg-white px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {values.map((x) => (
        <option key={x} value={x}>
          {title(x)}
        </option>
      ))}
    </select>
  );
}
function Pick({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: Entry[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = items.find((x) => x.id === value);
  const loadOptions = useCallback(
    async (q: string) =>
      items
        .filter(
          (x) =>
            x.active !== false &&
            x.name.toLowerCase().includes(q.toLowerCase()),
        )
        .map((x) => ({ value: x.id, label: x.name })),
    [items],
  );
  return (
    <div className="grid gap-2">
      <Label className="text-xs">{label}</Label>
      <Combobox
        id={label.replaceAll(" ", "-")}
        value={selected ? { value: selected.id, label: selected.name } : null}
        onValueChange={(v) => onChange(v?.value ?? "")}
        loadOptions={loadOptions}
        placeholder="Choose…"
      />
    </div>
  );
}
function Frame({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-5 p-4 shadow-none sm:p-6">
      <CardContent className="space-y-5 p-0">{children}</CardContent>
    </Card>
  );
}
export function TransportPage({
  section,
  data,
  session,
}: {
  section: string;
  data: TransportPageData;
  session: AdminSession;
}) {
  const router = useRouter(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(path: string, body: unknown, method = "POST") {
    setError("");
    setBusy(true);
    try {
      const result = await transportRequest(
        path,
        session.csrfToken,
        body,
        method,
      );
      await router.invalidate();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  if (data.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{data.error}</AlertDescription>
      </Alert>
    );
  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        group={
          ["earnings", "activities"].includes(section)
            ? "Review & records"
            : section === "dispatch"
              ? "Operations"
              : "People & assets"
        }
        title={
          section === "pricing"
            ? "Transport rates"
            : section === "earnings"
              ? "Truck earnings"
              : section === "activities"
                ? "Activities & review"
                : title(section)
        }
        description={
          {
            customers: "Manage customers and suppliers",
            locations: "Manage collection and delivery sites",
            products: "Manage products and measurement units",
            pricing: "Manage transport agreements",
            dispatch: "Plan collections and deliveries",
            activities: "Review driver activity",
            earnings: "Review revenue and fuel purchases",
          }[section]
        }
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {["customers", "locations", "products"].includes(section) && (
        <MasterPage
          key={section}
          section={section}
          catalogue={data.catalogue}
          session={session}
          save={save}
          busy={busy}
        />
      )}
      {section === "pricing" && (
        <Rates
          catalogue={data.catalogue}
          rates={data.rates ?? []}
          session={session}
          save={save}
          busy={busy}
        />
      )}
      {section === "dispatch" && data.jobs && (
        <Jobs
          catalogue={data.catalogue}
          jobs={data.jobs}
          session={session}
          save={save}
          busy={busy}
        />
      )}
      {section === "activities" && (
        <Activities
          rows={data.records ?? []}
          catalogue={data.catalogue}
          session={session}
          save={save}
          busy={busy}
        />
      )}
      {section === "earnings" && <Earnings session={session} />}
    </div>
  );
}
type Save = (path: string, body: unknown, method?: string) => Promise<unknown>;
function MasterPage({
  section,
  catalogue,
  session,
  save,
  busy,
}: {
  section: string;
  catalogue: Catalogue;
  session: AdminSession;
  save: Save;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<Entry | null>(null),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [customer, setCustomer] = useState(""),
    [product, setProduct] = useState("");
  const rows = catalogue[section as "customers" | "locations" | "products"],
    write = can(session, `${section}.write`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: f.get("name"),
      active: f.get("active") === "on",
      version: editing?.version ?? 0,
    };
    if (section === "customers")
      for (const k of ["contact", "email", "phone", "notes"])
        body[k] = f.get(k);
    if (section === "products") body.unit = f.get("unit");
    if (section === "locations") {
      for (const k of ["directions", "contact", "phone"]) body[k] = f.get(k);
      body.customerIds = f.getAll("customerIds");
      for (const k of ["latitude", "longitude"])
        body[k] = f.get(k) ? Number(f.get(k)) : null;
    }
    try {
      await save(
        `master/${section}${editing ? "/" + editing.id : ""}`,
        body,
        editing ? "PATCH" : "POST",
      );
      setOpen(false);
    } catch {}
  }
  return (
    <>
      <Frame>
        <div className="flex flex-wrap gap-3">
          <Input
            aria-label="Search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:max-w-sm"
          />
          {write && (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              Add{" "}
              {section === "customers"
                ? "customer"
                : section === "locations"
                  ? "location"
                  : "product"}
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>
                {section === "products" ? "Unit" : "Contact"}
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows
              .filter((x) => x.name.toLowerCase().includes(query.toLowerCase()))
              .map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">{x.name}</TableCell>
                  <TableCell>
                    {String(
                      section === "products"
                        ? title(String(x.unit))
                        : (x.contact ?? "—"),
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {x.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {write && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditing(x);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {!rows.length && (
          <p className="text-sm text-muted-foreground">No {section} yet.</p>
        )}
      </Frame>
      {open && (
        <Frame>
          <h2 className="font-semibold">
            {editing ? "Edit" : "Add"}{" "}
            {section === "customers"
              ? "customer"
              : section === "locations"
                ? "location"
                : "product"}
          </h2>
          <form
            key={editing?.id ?? "new"}
            onSubmit={(e) => void submit(e)}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={editing?.name ?? ""}
                />
              </Field>
              {section === "products" ? (
                <Field label="Unit">
                  <select
                    name="unit"
                    className="h-10 rounded-md border px-3"
                    defaultValue={String(editing?.unit ?? "tonne")}
                  >
                    {catalogue.units.map((x) => (
                      <option key={x} value={x}>
                        {title(x)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                [
                  "contact",
                  "phone",
                  ...(section === "customers"
                    ? ["email", "notes"]
                    : ["directions", "latitude", "longitude"]),
                ].map((k) => (
                  <Field key={k} label={title(k)}>
                    <Input name={k} defaultValue={String(editing?.[k] ?? "")} />
                  </Field>
                ))
              )}
            </div>
            {section === "locations" && (
              <div className="space-y-2">
                <Label>Customers</Label>
                <div className="flex flex-wrap gap-4">
                  {catalogue.customers.map((c) => (
                    <label key={c.id} className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="customerIds"
                        value={c.id}
                        defaultChecked={(
                          (editing?.customerIds ?? []) as string[]
                        ).includes(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex gap-2 text-sm">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.active ?? true}
              />
              Active
            </label>
            <div className="flex gap-2">
              <Button disabled={busy}>Save</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Frame>
      )}
      {section === "customers" && (
        <Frame>
          <h2 className="font-semibold">Customer products</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Supplies</TableHead>
                <TableHead>Receives</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogue.customerProducts.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    {
                      catalogue.customers.find((c) => c.id === x.customerId)
                        ?.name
                    }
                  </TableCell>
                  <TableCell>
                    {catalogue.products.find((p) => p.id === x.productId)?.name}
                  </TableCell>
                  <TableCell>
                    {write ? (
                      <input
                        aria-label={`Supplies ${catalogue.products.find((p) => p.id === x.productId)?.name}`}
                        type="checkbox"
                        checked={Boolean(x.supplies)}
                        disabled={busy}
                        onChange={(e) =>
                          void save(
                            `master/customer-products/${x.id}`,
                            {
                              customerId: x.customerId,
                              productId: x.productId,
                              supplies: e.target.checked,
                              receives: x.receives,
                              active: x.active,
                              version: x.version,
                            },
                            "PATCH",
                          ).catch(() => {})
                        }
                      />
                    ) : x.supplies ? (
                      "Yes"
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {write ? (
                      <input
                        aria-label={`Receives ${catalogue.products.find((p) => p.id === x.productId)?.name}`}
                        type="checkbox"
                        checked={Boolean(x.receives)}
                        disabled={busy}
                        onChange={(e) =>
                          void save(
                            `master/customer-products/${x.id}`,
                            {
                              customerId: x.customerId,
                              productId: x.productId,
                              supplies: x.supplies,
                              receives: e.target.checked,
                              active: x.active,
                              version: x.version,
                            },
                            "PATCH",
                          ).catch(() => {})
                        }
                      />
                    ) : x.receives ? (
                      "Yes"
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {write && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void save(
                            `master/customer-products/${x.id}`,
                            {
                              customerId: x.customerId,
                              productId: x.productId,
                              supplies: x.supplies,
                              receives: x.receives,
                              active: !x.active,
                              version: x.version,
                            },
                            "PATCH",
                          ).catch(() => {})
                        }
                      >
                        {x.active ? "Archive" : "Restore"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {write && (
            <form
              className="grid items-end gap-4 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save("master/customer-products", {
                  customerId: customer,
                  productId: product,
                  supplies: f.get("supplies") === "on",
                  receives: f.get("receives") === "on",
                  active: true,
                }).catch(() => {});
              }}
            >
              <Pick
                label="Customer"
                items={catalogue.customers}
                value={customer}
                onChange={setCustomer}
              />
              <Pick
                label="Product"
                items={catalogue.products}
                value={product}
                onChange={setProduct}
              />
              <div className="space-y-2 text-sm">
                <label className="flex gap-2">
                  <input name="supplies" type="checkbox" />
                  Supplies
                </label>
                <label className="flex gap-2">
                  <input name="receives" type="checkbox" defaultChecked />
                  Receives
                </label>
              </div>
              <Button disabled={busy || !customer || !product}>
                Add product
              </Button>
            </form>
          )}
        </Frame>
      )}
    </>
  );
}
function Rates({
  catalogue,
  rates,
  session,
  save,
  busy,
}: {
  catalogue: Catalogue;
  rates: Entry[];
  session: AdminSession;
  save: Save;
  busy: boolean;
}) {
  const [link, setLink] = useState(""),
    [origin, setOrigin] = useState(""),
    [destination, setDestination] = useState(""),
    [method, setMethod] = useState("quantity"),
    [basis, setBasis] = useState("delivered"),
    [u, setU] = useState("tonne");
  const links = catalogue.customerProducts.map((x) => ({
    ...x,
    name: `${catalogue.customers.find((c) => c.id === x.customerId)?.name} · ${catalogue.products.find((p) => p.id === x.productId)?.name}`,
  }));
  return (
    <>
      <Frame>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Customer / product",
                "Route",
                "Rate",
                "Basis",
                "Dates",
                "",
              ].map((x) => (
                <TableHead key={x}>{x}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {links.find((x) => x.id === r.customerProductId)?.name}
                </TableCell>
                <TableCell>
                  {r.originId
                    ? `${catalogue.locations.find((x) => x.id === r.originId)?.name} → ${catalogue.locations.find((x) => x.id === r.destinationId)?.name}`
                    : "Default"}
                </TableCell>
                <TableCell>
                  {money(r.price)} /{" "}
                  {r.method === "delivery" ? "delivery" : String(r.unit)}
                </TableCell>
                <TableCell>{title(String(r.basis))}</TableCell>
                <TableCell>
                  {String(r.startsOn)} → {String(r.endsOn ?? "Ongoing")}
                </TableCell>
                <TableCell>
                  {can(session, "pricing.write") && (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void save(
                          `rates/${r.id}`,
                          {
                            endsOn: f.get("endsOn"),
                            expectedEndsOn: r.endsOn,
                            reason: f.get("reason"),
                          },
                          "PATCH",
                        ).catch(() => {});
                      }}
                    >
                      <Input
                        type="date"
                        aria-label="End date"
                        name="endsOn"
                        required
                      />
                      <Input
                        aria-label="Reason"
                        name="reason"
                        placeholder="Reason"
                        required
                      />
                      <Button variant="outline" disabled={busy}>
                        End rate
                      </Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>
      {can(session, "pricing.write") && (
        <Frame>
          <h2 className="font-semibold">Add agreed rate</h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save("rates", {
                customerProductId: link,
                originId: origin || null,
                destinationId: destination || null,
                method,
                basis,
                unit: u,
                price: f.get("price"),
                startsOn: f.get("startsOn"),
                endsOn: f.get("endsOn") || null,
              }).catch(() => {});
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Pick
                label="Customer product"
                items={links}
                value={link}
                onChange={setLink}
              />
              <Pick
                label="Collection site"
                items={catalogue.locations}
                value={origin}
                onChange={setOrigin}
              />
              <Pick
                label="Delivery site"
                items={catalogue.locations}
                value={destination}
                onChange={setDestination}
              />
              <Field label="Pricing">
                <Select
                  value={method}
                  onChange={setMethod}
                  values={["quantity", "delivery"]}
                />
              </Field>
              <Field label="Bill using">
                <Select
                  value={basis}
                  onChange={setBasis}
                  values={["collected", "delivered"]}
                />
              </Field>
              <Field label="Unit">
                <Select value={u} onChange={setU} values={catalogue.units} />
              </Field>
              <Field label="Agreed amount (R)">
                <Input name="price" inputMode="decimal" required />
              </Field>
              <Field label="Starts on">
                <Input name="startsOn" type="date" required />
              </Field>
              <Field label="Ends on">
                <Input name="endsOn" type="date" />
              </Field>
            </div>
            <Button disabled={busy || !link}>Save rate</Button>
          </form>
        </Frame>
      )}
    </>
  );
}
function Jobs({
  catalogue,
  jobs,
  session,
  save,
  busy,
}: {
  catalogue: Catalogue;
  jobs: NonNullable<TransportPageData["jobs"]>;
  session: AdminSession;
  save: Save;
  busy: boolean;
}) {
  const fresh = (): Job => ({
    id: "",
    reference: "",
    date: new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Johannesburg",
    }),
    driverId: "",
    truckId: "",
    status: "draft",
    version: 0,
    plan: {
      customer: emptyRef,
      product: emptyRef,
      supplier: emptyRef,
      origin: emptyRef,
      quantity: "",
      unit: "tonne",
      instructions: "",
      collectionId: crypto.randomUUID(),
      deliveries: [
        {
          id: crypto.randomUUID(),
          destination: emptyRef,
          receiver: emptyRef,
          quantity: "",
          collectedQuantity: null,
        },
      ],
    },
  });
  const [job, setJob] = useState<Job | null>(null);
  const change = (k: string, v: unknown) =>
    setJob((j) => (j ? { ...j, [k]: v } : j));
  const plan = (k: string, v: unknown) =>
    setJob((j) => (j ? { ...j, plan: { ...j.plan, [k]: v } } : j));
  function pickRef(
    k: "customer" | "product" | "origin" | "supplier",
    recordId: string,
  ) {
    const items =
      k === "product"
        ? catalogue.products
        : k === "origin"
          ? catalogue.locations
          : catalogue.customers;
    plan(k, {
      id: recordId || null,
      name: items.find((x) => x.id === recordId)?.name ?? "",
    });
  }
  return (
    <>
      {can(session, "dispatch.write") && (
        <Button onClick={() => setJob(fresh())}>Plan a job</Button>
      )}
      <Frame>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Reference",
                "Date",
                "Customer / product",
                "Stops",
                "Status",
                "",
              ].map((x) => (
                <TableHead key={x}>{x}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.items.map((j) => (
              <TableRow key={j.id}>
                <TableCell>{j.reference}</TableCell>
                <TableCell>{j.date}</TableCell>
                <TableCell>
                  {j.plan.customer.name} · {j.plan.product.name}
                </TableCell>
                <TableCell>{j.plan.deliveries.length} deliveries</TableCell>
                <TableCell>
                  {title(j.status)}
                  {j.allocationConflict && (
                    <Badge variant="outline">Check vehicle allocation</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {can(session, "dispatch.write") && (
                    <Button variant="ghost" onClick={() => setJob(j)}>
                      Open
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>
      {job && (
        <Frame>
          <h2 className="font-semibold">{job.reference || "Plan a job"}</h2>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              const {
                id: jobId,
                version: ver,
                reference,
                date,
                driverId,
                truckId,
                status,
                plan,
              } = job;
              void save(
                `dispatches${jobId ? "/" + jobId : ""}`,
                {
                  version: ver,
                  reference,
                  date,
                  driverId,
                  truckId,
                  status,
                  plan,
                },
                jobId ? "PATCH" : "POST",
              )
                .then(() => setJob(null))
                .catch(() => {});
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Reference">
                <Input
                  required
                  value={job.reference}
                  onChange={(e) => change("reference", e.target.value)}
                />
              </Field>
              <Field label="Date">
                <Input
                  type="date"
                  required
                  value={job.date}
                  onChange={(e) => change("date", e.target.value)}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={job.status}
                  onChange={(v) => change("status", v)}
                  values={["draft", "dispatched", "cancelled"]}
                />
              </Field>
              <Pick
                label="Driver"
                items={jobs.drivers}
                value={job.driverId}
                onChange={(v) => change("driverId", v)}
              />
              <Pick
                label="Vehicle"
                items={jobs.trucks.map((t) => ({
                  ...t,
                  name: `${t.identifier} · ${t.registration}`,
                }))}
                value={job.truckId}
                onChange={(v) => {
                  change("truckId", v);
                  void fetch(
                    `/api/admin/schedules?from=${job.date}&to=${job.date}`,
                  )
                    .then((r) => (r.ok ? r.json() : null))
                    .then(
                      (
                        s: {
                          items?: { truckId: string; driverId: string }[];
                        } | null,
                      ) => {
                        const match = s?.items?.find((x) => x.truckId === v);
                        if (match) change("driverId", match.driverId);
                      },
                    )
                    .catch(() => {});
                }}
              />
              <Pick
                label="Paying customer"
                items={catalogue.customers}
                value={job.plan.customer.id ?? ""}
                onChange={(v) => pickRef("customer", v)}
              />
              <Pick
                label="Product"
                items={catalogue.products}
                value={job.plan.product.id ?? ""}
                onChange={(v) => {
                  pickRef("product", v);
                  plan(
                    "unit",
                    String(
                      catalogue.products.find((p) => p.id === v)?.unit ??
                        "tonne",
                    ),
                  );
                }}
              />
              <Pick
                label="Supplier"
                items={catalogue.customers}
                value={job.plan.supplier.id ?? ""}
                onChange={(v) => pickRef("supplier", v)}
              />
              <Pick
                label="Collection site"
                items={catalogue.locations}
                value={job.plan.origin.id ?? ""}
                onChange={(v) => pickRef("origin", v)}
              />
              <Field label="Collected quantity">
                <Input
                  required
                  inputMode="decimal"
                  value={job.plan.quantity}
                  onChange={(e) => plan("quantity", e.target.value)}
                />
              </Field>
              <Field label="Unit">
                <Select
                  value={job.plan.unit}
                  onChange={(v) => plan("unit", v)}
                  values={catalogue.units}
                />
              </Field>
              <Field label="Instructions">
                <Input
                  value={job.plan.instructions}
                  onChange={(e) => plan("instructions", e.target.value)}
                />
              </Field>
            </div>
            <h3 className="font-medium">Deliveries</h3>
            {job.plan.deliveries.map((line, index) => (
              <div
                key={line.id}
                className="grid items-end gap-4 rounded-lg border p-4 sm:grid-cols-5"
              >
                <Pick
                  label={`Site ${index + 1}`}
                  items={catalogue.locations}
                  value={line.destination.id ?? ""}
                  onChange={(v) =>
                    plan(
                      "deliveries",
                      job.plan.deliveries.map((x) =>
                        x.id === line.id
                          ? {
                              ...x,
                              destination: {
                                id: v || null,
                                name:
                                  catalogue.locations.find((s) => s.id === v)
                                    ?.name ?? "",
                              },
                            }
                          : x,
                      ),
                    )
                  }
                />
                <Pick
                  label={`Receiver ${index + 1}`}
                  items={catalogue.customers}
                  value={line.receiver.id ?? ""}
                  onChange={(v) =>
                    plan(
                      "deliveries",
                      job.plan.deliveries.map((x) =>
                        x.id === line.id
                          ? {
                              ...x,
                              receiver: {
                                id: v || null,
                                name:
                                  catalogue.customers.find((s) => s.id === v)
                                    ?.name ?? "",
                              },
                            }
                          : x,
                      ),
                    )
                  }
                />
                {["quantity", "collectedQuantity"].map((k) => (
                  <Field
                    key={k}
                    label={
                      k === "quantity" ? "Deliver quantity" : "Loaded share"
                    }
                  >
                    <Input
                      inputMode="decimal"
                      value={line[k as "quantity" | "collectedQuantity"] ?? ""}
                      onChange={(e) =>
                        plan(
                          "deliveries",
                          job.plan.deliveries.map((x) =>
                            x.id === line.id
                              ? { ...x, [k]: e.target.value || null }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    plan(
                      "deliveries",
                      job.plan.deliveries.filter((x) => x.id !== line.id),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                plan("deliveries", [
                  ...job.plan.deliveries,
                  {
                    id: crypto.randomUUID(),
                    destination: emptyRef,
                    receiver: emptyRef,
                    quantity: "",
                    collectedQuantity: null,
                  },
                ])
              }
            >
              Add delivery
            </Button>
            <div className="flex gap-2">
              <Button disabled={busy}>Save job</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setJob(null)}
              >
                Close
              </Button>
            </div>
          </form>
        </Frame>
      )}
    </>
  );
}
function Activities({
  rows,
  catalogue,
  session,
  save,
  busy,
}: {
  rows: RecordRow[];
  catalogue: Catalogue;
  session: AdminSession;
  save: Save;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<RecordRow | null>(null),
    [details, setDetails] = useState<{
      revisions: {
        id: string;
        submission: { data: ActivityData };
        conflict: boolean;
      }[];
      audits: {
        id: string;
        action: string;
        reason: string;
        createdAt: string;
      }[];
    } | null>(null),
    [query, setQuery] = useState("");
  const change = (k: string, v: Json) =>
    setSelected((s) => (s ? { ...s, data: { ...s.data, [k]: v } } : s));
  return (
    <>
      <Input
        placeholder="Search activities…"
        aria-label="Search activities"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Frame>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "When",
                "Vehicle / driver",
                "Activity",
                "Customer / product",
                "Quantity",
                "Review",
                ...(can(session, "revenue.read") ? ["Estimate"] : []),
                "",
              ].map((x) => (
                <TableHead key={x}>{x}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows
              .filter((r) =>
                JSON.stringify(r).toLowerCase().includes(query.toLowerCase()),
              )
              .map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {new Date(r.occurredAt).toLocaleString("en-ZA", {
                      timeZone: "Africa/Johannesburg",
                    })}
                  </TableCell>
                  <TableCell>
                    {r.registration}
                    <p className="text-xs text-muted-foreground">
                      {r.driverName}
                    </p>
                  </TableCell>
                  <TableCell>{title(r.kind)}</TableCell>
                  <TableCell>
                    {r.data.customer.name} · {r.data.product.name}
                  </TableCell>
                  <TableCell>
                    {r.kind === "fuel"
                      ? `${r.data.fuelLitres ?? "—"} litres`
                      : `${r.data.quantity ?? "—"} ${r.data.unit}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{title(r.review)}</Badge>
                  </TableCell>
                  {can(session, "revenue.read") && (
                    <TableCell>
                      {r.amount
                        ? money(r.amount)
                        : r.pricingStatus
                          ? title(r.pricingStatus)
                          : "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSelected(structuredClone(r));
                        setDetails(null);
                        void transportRequest<typeof details>(
                          `records/${r.id}`,
                          session.csrfToken,
                        )
                          .then(setDetails)
                          .catch(() => {});
                      }}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Frame>
      {selected && (
        <Frame>
          <div className="flex justify-between">
            <h2 className="font-semibold">
              {title(selected.kind)} · {selected.registration}
            </h2>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          {selected.flags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.flags.map((f) => (
                <Badge key={f} variant="outline">
                  {title(f)}
                </Badge>
              ))}
            </div>
          )}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save(`records/${selected.id}/review`, {
                version: selected.version,
                truckId: selected.truckId,
                action: f.get("action"),
                reason: f.get("reason"),
                data: selected.data,
                reprice: f.get("reprice") === "on",
              })
                .then(() => setSelected(null))
                .catch(() => {});
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  "customer",
                  "product",
                  "origin",
                  "destination",
                  "supplier",
                  "receiver",
                ] as const
              ).map((k) => (
                <Pick
                  key={k}
                  label={`${title(k)}${!selected.data[k].id && selected.data[k].name ? ` · ${selected.data[k].name}` : ""}`}
                  items={
                    k === "product"
                      ? catalogue.products
                      : ["origin", "destination"].includes(k)
                        ? catalogue.locations
                        : catalogue.customers
                  }
                  value={selected.data[k].id ?? ""}
                  onChange={(v) => {
                    const items =
                      k === "product"
                        ? catalogue.products
                        : ["origin", "destination"].includes(k)
                          ? catalogue.locations
                          : catalogue.customers;
                    change(k, {
                      id: v || null,
                      name:
                        items.find((x) => x.id === v)?.name ??
                        selected.data[k].name,
                    });
                  }}
                />
              ))}
              {[
                "quantity",
                "collectedQuantity",
                "fuelLitres",
                "fuelTotalCost",
                "occurredAt",
                "note",
              ].map((k) => (
                <Field key={k} label={title(k.replace(/([A-Z])/g, " $1"))}>
                  <Input
                    value={String(selected.data[k] ?? "")}
                    onChange={(e) => change(k, e.target.value || null)}
                  />
                </Field>
              ))}
              <Field label="Unit">
                <Select
                  value={selected.data.unit}
                  onChange={(v) => change("unit", v)}
                  values={catalogue.units}
                />
              </Field>
              {can(session, "activities.review") && (
                <Pick
                  label="Actual vehicle"
                  items={catalogue.trucks ?? []}
                  value={String(selected.truckId ?? "")}
                  onChange={(v) => setSelected({ ...selected, truckId: v })}
                />
              )}
              <Field label="Outcome">
                <Select
                  value={selected.data.outcome}
                  onChange={(v) => change("outcome", v)}
                  values={["completed", "partial", "failed", "cancelled"]}
                />
              </Field>
              {selected.data.allocations.map((share, index) => (
                <Field
                  key={share.deliveryId}
                  label={`Loaded share · delivery ${index + 1}`}
                >
                  <Input
                    inputMode="decimal"
                    value={share.quantity}
                    onChange={(e) =>
                      change(
                        "allocations",
                        selected.data.allocations.map((x) =>
                          x.deliveryId === share.deliveryId
                            ? { ...x, quantity: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
            </div>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.data.transportCharge}
                onChange={(e) => change("transportCharge", e.target.checked)}
              />
              Transport charge applies
            </label>
            {details?.revisions.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <span>
                  {r.conflict ? "Conflicting entry" : "Driver entry"} ·{" "}
                  {r.submission.data.customer.name} ·{" "}
                  {r.submission.data.quantity ??
                    r.submission.data.fuelLitres ??
                    "—"}
                </span>
                {can(session, "activities.review") && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setSelected({
                        ...selected,
                        data: structuredClone(r.submission.data),
                      })
                    }
                  >
                    Use entry
                  </Button>
                )}
              </div>
            ))}
            {can(session, "activities.review") && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Decision">
                    <select
                      className="h-10 rounded-md border px-3"
                      name="action"
                      defaultValue="validated"
                    >
                      {["validated", "pending", "clarification", "void"].map(
                        (x) => (
                          <option key={x} value={x}>
                            {title(x)}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="Reason">
                    <Input name="reason" required maxLength={1000} />
                  </Field>
                </div>
                {can(session, "pricing.write") && (
                  <label className="flex gap-2 text-sm">
                    <input type="checkbox" name="reprice" />
                    Apply current agreed rate
                  </label>
                )}
                <Button disabled={busy}>Save review</Button>
              </>
            )}
          </form>
          {details && (
            <details className="text-xs">
              <summary>Original entries and review history</summary>
              <div className="mt-3 space-y-3">
                {details.revisions.map((r) => (
                  <div key={r.id} className="rounded-md border p-3">
                    <p>
                      {new Date(r.submission.data.occurredAt).toLocaleString(
                        "en-ZA",
                        { timeZone: "Africa/Johannesburg" },
                      )}{" "}
                      · {title(r.submission.data.kind)}
                    </p>
                    <p>
                      {r.submission.data.customer.name ||
                        "Customer not recorded"}{" "}
                      ·{" "}
                      {r.submission.data.product.name || "Product not recorded"}
                    </p>
                    <p>
                      {r.submission.data.origin.name} →{" "}
                      {r.submission.data.destination.name}
                    </p>
                    <p>
                      {r.submission.data.quantity ??
                        r.submission.data.fuelLitres ??
                        "—"}{" "}
                      {r.submission.data.kind === "fuel"
                        ? "litres"
                        : r.submission.data.unit}
                    </p>
                    <p>{r.submission.data.note}</p>
                  </div>
                ))}
                {details.audits.map((a) => (
                  <p key={a.id}>
                    {new Date(a.createdAt).toLocaleString("en-ZA", {
                      timeZone: "Africa/Johannesburg",
                    })}{" "}
                    · {title(a.action)} · {a.reason}
                  </p>
                ))}
              </div>
            </details>
          )}
        </Frame>
      )}
    </>
  );
}
function Earnings({ session }: { session: AdminSession }) {
  const [month, setMonth] = useState(
      new Date()
        .toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" })
        .slice(0, 7),
    ),
    [data, setData] = useState<{
      generatedAt: string;
      totals: Record<string, unknown>[];
      byCustomer: {
        truckId: string;
        name: string;
        deliveries: number;
        amount: string;
        unpriced: number;
      }[];
      byProduct: {
        truckId: string;
        name: string;
        deliveries: number;
        amount: string;
        unpriced: number;
      }[];
      records: RecordRow[];
    } | null>(null),
    [error, setError] = useState(""),
    [customer, setCustomer] = useState(""),
    [product, setProduct] = useState(""),
    [truck, setTruck] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    void transportRequest<typeof data>(
      `earnings?month=${month}`,
      session.csrfToken,
    )
      .then((x) => {
        if (active) setData(x);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [month, session.csrfToken]);
  return (
    <>
      <Field label="Month">
        <Input
          className="max-w-52"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {data && (
        <>
          <Field label="Vehicle">
            <select
              className="h-10 max-w-sm rounded-md border bg-white px-3"
              value={truck}
              onChange={(e) => setTruck(e.target.value)}
            >
              <option value="">All vehicles</option>
              {data.totals.map((t) => (
                <option key={String(t.truckId)} value={String(t.truckId)}>
                  {String(t.truckName)} · {String(t.registration)}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            Synced records · report generated{" "}
            {new Date(data.generatedAt).toLocaleString("en-ZA", {
              timeZone: "Africa/Johannesburg",
            })}
          </p>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Vehicle",
                    "Deliveries",
                    "Estimated revenue",
                    "Validated",
                    "Awaiting review",
                    "Needs pricing",
                    "Fuel litres",
                    "Fuel spend",
                    "Missing fuel prices",
                    "Latest record",
                  ].map((x) => (
                    <TableHead key={x}>{x}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.totals
                  .filter((t) => !truck || t.truckId === truck)
                  .map((t) => (
                    <TableRow key={String(t.truckId)}>
                      <TableCell>
                        {String(t.truckName)}
                        <p className="text-xs">{String(t.registration)}</p>
                      </TableCell>
                      {[
                        "deliveries",
                        "revenue",
                        "validated",
                        "awaitingReview",
                        "unpriced",
                        "fuelLitres",
                        "fuelSpend",
                        "missingFuelPrices",
                        "lastRecordAt",
                      ].map((k) => (
                        <TableCell key={k}>
                          {[
                            "revenue",
                            "validated",
                            "awaitingReview",
                            "fuelSpend",
                          ].includes(k)
                            ? money(t[k])
                            : k === "lastRecordAt"
                              ? new Date(String(t[k])).toLocaleString("en-ZA", {
                                  timeZone: "Africa/Johannesburg",
                                })
                              : String(t[k])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            {!data.totals.length && (
              <p className="text-sm text-muted-foreground">
                No synced records for this month.
              </p>
            )}
          </Frame>
          {[
            { name: "By customer", rows: data.byCustomer ?? [] },
            { name: "By product", rows: data.byProduct ?? [] },
          ].map((group) => (
            <Frame key={group.name}>
              <h2 className="font-semibold">{group.name}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      "Name",
                      "Vehicle",
                      "Deliveries",
                      "Estimated revenue",
                      "Needs pricing",
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows
                    .filter((r) => !truck || r.truckId === truck)
                    .map((r, i) => (
                      <TableRow key={`${r.truckId}-${i}`}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>
                          {String(
                            data.totals.find((t) => t.truckId === r.truckId)
                              ?.truckName ?? "",
                          )}
                        </TableCell>
                        <TableCell>{r.deliveries}</TableCell>
                        <TableCell>{money(r.amount)}</TableCell>
                        <TableCell>{r.unpriced}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </Frame>
          ))}
          <div className="flex gap-3">
            <Input
              placeholder="Filter customer"
              aria-label="Filter customer"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
            <Input
              placeholder="Filter product"
              aria-label="Filter product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            />
          </div>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Vehicle",
                    "Customer",
                    "Product",
                    "Delivered",
                    "Estimate",
                    "Review",
                  ].map((x) => (
                    <TableHead key={x}>{x}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.records
                  .filter(
                    (r) =>
                      r.kind === "delivery" &&
                      (!truck || r.truckId === truck) &&
                      r.data.customer.name
                        .toLowerCase()
                        .includes(customer.toLowerCase()) &&
                      r.data.product.name
                        .toLowerCase()
                        .includes(product.toLowerCase()),
                  )
                  .map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.registration}</TableCell>
                      <TableCell>{r.data.customer.name}</TableCell>
                      <TableCell>{r.data.product.name}</TableCell>
                      <TableCell>
                        {r.data.quantity ?? "—"} {r.data.unit}
                      </TableCell>
                      <TableCell>
                        {r.amount
                          ? money(r.amount)
                          : title(r.pricingStatus ?? "uncharged")}
                      </TableCell>
                      <TableCell>{title(r.review)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Frame>
        </>
      )}
    </>
  );
}
