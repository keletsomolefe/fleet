import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader, CreateAction } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar } from "@/components/filter-bar";
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
  createTruckExpense,
  currentOperationalDate,
  currentOperationalMonth,
  expenseCategoryLabels,
  formatZar,
  getExpenses,
  getTransportCatalogue,
  uploadTransportAttachment,
  voidTruckExpense,
  type TruckExpenseCategory,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/expenses")({
  loader: async ({ context }) => {
    if (
      !can(context.session, "expenses.read") &&
      !can(context.session, "revenue.read")
    )
      return;
    const month = currentOperationalMonth();
    const initialFilters = { month, truckId: "", category: "" };
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
          "transport-expenses",
          initialFilters,
        ],
        queryFn: () => getExpenses({ month }),
      }),
    ]);
  },
  component: ExpensesPage,
});

const sourceLabels = {
  office_expense: "Office invoice",
  driver_fuel: "Driver fuel",
  driver_expense: "Driver road cost",
  service_job: "Service job repair",
} as const;

function ExpensesPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "expenses.read") || can(session, "revenue.read");
  const writable = can(session, "expenses.write");

  const [month, setMonth] = useState(currentOperationalMonth());
  const [truckId, setTruckId] = useState("");
  const [category, setCategory] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [formTruckId, setFormTruckId] = useState("");
  const [occurredOn, setOccurredOn] = useState(currentOperationalDate());
  const [formCategory, setFormCategory] =
    useState<TruckExpenseCategory>("repair");
  const [vendor, setVendor] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [litres, setLitres] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const expensesQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "transport-expenses",
      { month, truckId, category },
    ],
    queryFn: () =>
      getExpenses({
        month: month || undefined,
        truckId: truckId || undefined,
        category: category || undefined,
      }),
    enabled: readable,
  });

  if (!readable) {
    return <PageError message="You do not have access to Expenses." />;
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      const created = await createTruckExpense(session.csrfToken, {
        truckId: formTruckId,
        occurredOn,
        category: formCategory,
        vendor,
        invoiceNumber,
        amount,
        litres: litres.trim() || null,
        odometerKm: odometerKm.trim() || null,
        notes,
      });
      if (receiptFile) {
        await uploadTransportAttachment(
          session.csrfToken,
          "expense",
          created.id,
          receiptFile,
          formCategory === "fuel" ? "fuel_receipt" : "expense_receipt",
        );
      }
      setShowForm(false);
      setVendor("");
      setInvoiceNumber("");
      setAmount("");
      setLitres("");
      setOdometerKm("");
      setNotes("");
      setReceiptFile(null);
      setStatusMessage("Expense recorded.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save expense.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid(id: string) {
    setBusy(true);
    setFormError("");
    try {
      await voidTruckExpense(session.csrfToken, id, voidReason);
      setVoidingId(null);
      setVoidReason("");
      setStatusMessage("Expense voided.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not void expense.",
      );
    } finally {
      setBusy(false);
    }
  }

  const items = expensesQuery.data?.items ?? [];
  const totalAmount = items.reduce((acc, row) => acc + Number(row.amount || 0), 0);

  return (
    <>
      <PageHeader
        title="Expenses"
        group="Finance & review"
        description="Unified vehicle spending across driver petrol logs, road expenses, completed breakdown repairs, and office workshop invoices."
        actions={
          <>
            <RefreshButton
              busy={expensesQuery.isFetching}
              onRefresh={() => void expensesQuery.refetch()}
            />
            <ExportMenu
              dataset="expenses"
              filters={{
                month: month || undefined,
                truckId: truckId || undefined,
                category: category || undefined,
              }}
            />
            {writable && (
              <CreateAction onClick={() => setShowForm((v) => !v)}>
                <Plus /> Add office expense
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
      {expensesQuery.error && <PageError message={expensesQuery.error.message} />}
      {formError && <PageError message={formError} />}

      {showForm && writable && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              Record workshop / office vehicle expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => void handleCreate(e)}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-1.5">
                <Label htmlFor="exp-truck">Vehicle</Label>
                <select
                  id="exp-truck"
                  required
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={formTruckId}
                  onChange={(e) => setFormTruckId(e.target.value)}
                >
                  <option value="">Choose vehicle…</option>
                  {(catalogueQuery.data?.trucks ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.registration} · {t.identifier}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-date">Date</Label>
                <Input
                  id="exp-date"
                  type="date"
                  required
                  value={occurredOn}
                  onChange={(e) => setOccurredOn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-cat">Category</Label>
                <select
                  id="exp-cat"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={formCategory}
                  onChange={(e) =>
                    setFormCategory(e.target.value as TruckExpenseCategory)
                  }
                >
                  {Object.entries(expenseCategoryLabels).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-amt">Amount (ZAR)</Label>
                <Input
                  id="exp-amt"
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 4850.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-vendor">Workshop / vendor / fuel station</Label>
                <Input
                  id="exp-vendor"
                  maxLength={160}
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-inv">Invoice / receipt #</Label>
                <Input
                  id="exp-inv"
                  maxLength={80}
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                />
              </div>
              {formCategory === "fuel" && (
                <div className="space-y-1.5">
                  <Label htmlFor="exp-litres">Litres (optional)</Label>
                  <Input
                    id="exp-litres"
                    inputMode="decimal"
                    value={litres}
                    onChange={(e) => setLitres(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="exp-odo">Odometer km (optional)</Label>
                <Input
                  id="exp-odo"
                  inputMode="decimal"
                  value={odometerKm}
                  onChange={(e) => setOdometerKm(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="exp-notes">Description / notes</Label>
                <Input
                  id="exp-notes"
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="exp-file">Invoice / receipt photo (optional)</Label>
                <Input
                  id="exp-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save expense"}
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

      <FilterBar
        activeCount={(truckId ? 1 : 0) + (category ? 1 : 0)}
        onClear={() => {
          setTruckId("");
          setCategory("");
        }}
        summary={
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Total</p>
            <p className="text-xs font-semibold tabular-nums">
              {formatZar(totalAmount)}
            </p>
          </div>
        }
      >
        <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4 @md:items-end">
          <div className="space-y-1">
            <Label className="text-xs">Month</Label>
            <Input
              type="month"
              className="h-10 text-xs"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
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
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {Object.entries(expenseCategoryLabels).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden rounded-lg border bg-muted/40 px-3 py-2 text-right @2xl:block">
            <p className="text-[11px] uppercase text-muted-foreground">
              Filtered total
            </p>
            <p className="text-base font-semibold tabular-nums">
              {formatZar(totalAmount)}
            </p>
          </div>
        </div>
      </FilterBar>

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        {expensesQuery.isPending ? (
          <ListRowsSkeleton rows={5} />
        ) : !items.length ? (
          <EmptyState
            icon="document"
            title="No expenses for this filter"
            description="Petrol fill-ups, road expenses, completed breakdown repairs, and workshop invoices will appear here."
          />
        ) : (
          <ul className="divide-y">
            {items.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 p-4 @2xl:flex-row @2xl:items-center @2xl:justify-between sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {expenseCategoryLabels[row.category] ?? row.category}
                    </Badge>
                    <Badge variant="outline">{sourceLabels[row.source]}</Badge>
                    <span className="text-xs font-medium">
                      {row.registration} · {row.truckIdentifier}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.occurredOn}
                    </span>
                  </div>
                  <p className="text-sm">
                    {row.vendor || "Unspecified vendor"}
                    {row.reference ? ` · Ref ${row.reference}` : ""}
                    {row.litres ? ` · ${row.litres} L` : ""}
                    {row.driverName ? ` · ${row.driverName}` : ""}
                  </p>
                  {row.notes && (
                    <p className="text-xs text-muted-foreground">{row.notes}</p>
                  )}
                </div>

                <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-3 @2xl:w-auto @2xl:justify-end">
                  <p className="text-base font-semibold tabular-nums">
                    {formatZar(row.amount)}
                  </p>
                  {row.recordId && (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/admin/activities/$recordId"
                        params={{ recordId: row.recordId }}
                      >
                        View activity
                      </Link>
                    </Button>
                  )}
                  {row.serviceJobId && (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/admin/jobs/$jobId"
                        params={{ jobId: row.serviceJobId }}
                      >
                        View job
                      </Link>
                    </Button>
                  )}
                  {row.source === "office_expense" && writable && !row.voidedAt && (
                    voidingId === row.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-8 w-44 text-xs"
                          placeholder="Reason to void"
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy || !voidReason.trim()}
                          onClick={() => void handleVoid(row.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setVoidingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setVoidingId(row.id);
                          setVoidReason("");
                        }}
                      >
                        Void
                      </Button>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
