import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageError } from "@/components/page-error";
import { PageHeader } from "@/components/page-header";
import { ReportPreviewSkeleton } from "@/components/page-skeletons";
import { RefreshButton } from "@/components/refresh-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import {
  activityKindLabels,
  currentOperationalDate,
  currentOperationalMonth,
  downloadReportFile,
  expenseCategoryLabels,
  formatZar,
  getReportPreview,
  getTransportCatalogue,
  reviewStatusLabels,
  type ActivityKind,
  type ReportDataset,
  type ReportFormat,
  type ReviewStatus,
} from "@/lib/transport";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/reports")({
  loader: async ({ context }) => {
    const first = datasetOptions.find((opt) =>
      opt.permissions.some((p) => can(context.session, p)),
    );
    if (!first) return;
    const month = currentOperationalMonth();
    const bounds = monthBounds(month);
    const defaultFilters: Record<string, string | boolean | undefined> =
      first.id === "earnings"
        ? { month, truckId: undefined }
        : first.id === "activities"
          ? {
              from: bounds.from,
              to: bounds.to,
              truckId: undefined,
              driverId: undefined,
              customerId: undefined,
              productId: undefined,
              kind: undefined,
              review: undefined,
              flagged: undefined,
            }
          : first.id === "expenses"
            ? {
                from: bounds.from,
                to: bounds.to,
                truckId: undefined,
                category: undefined,
                source: undefined,
                includeVoid: undefined,
              }
            : first.id === "shifts"
              ? {
                  from: bounds.from,
                  to: bounds.to,
                  truckId: undefined,
                  driverId: undefined,
                  flagged: undefined,
                }
              : {
                  from: bounds.from,
                  to: bounds.to,
                  truckId: undefined,
                  driverId: undefined,
                  customerId: undefined,
                  status: undefined,
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
          "report-preview",
          first.id,
          defaultFilters,
        ],
        queryFn: () => getReportPreview(first.id, defaultFilters),
      }),
    ]);
  },
  component: ReportsPage,
});

type DatasetOption = {
  id: ReportDataset;
  title: string;
  description: string;
  sheets: string;
  permissions: string[];
};

const datasetOptions: DatasetOption[] = [
  {
    id: "earnings",
    title: "Truck earnings & P&L",
    description: "Monthly revenue, fuel, repairs, margin by truck, customer & product.",
    sheets: "5 sheets in Excel",
    permissions: ["revenue.read"],
  },
  {
    id: "activities",
    title: "Driver activity ledger",
    description: "Collections, deliveries, petrol fill-ups, road costs, dwell & variance.",
    sheets: "2 sheets in Excel",
    permissions: ["activities.read"],
  },
  {
    id: "expenses",
    title: "Expenses & spend ledger",
    description: "Unified driver fuel, road costs, breakdown jobs & office invoices.",
    sheets: "2 sheets in Excel",
    permissions: ["expenses.read", "revenue.read"],
  },
  {
    id: "shifts",
    title: "Shifts & mileage proof",
    description: "Start/end odometer readings, distance travelled & proof exceptions.",
    sheets: "2 sheets in Excel",
    permissions: ["shifts.read"],
  },
  {
    id: "dispatches",
    title: "Dispatch & load plan",
    description: "Planned collections, multi-stop drop-offs, vehicle & driver allocation.",
    sheets: "2 sheets in Excel",
    permissions: ["dispatch.read"],
  },
];

const expenseSources = [
  { value: "driver_fuel", label: "Driver petrol / fuel" },
  { value: "driver_expense", label: "Driver road cost" },
  { value: "service_job", label: "Breakdown / service job" },
  { value: "office_expense", label: "Office invoice" },
];

const dispatchStatuses = [
  { value: "draft", label: "Draft" },
  { value: "dispatched", label: "Dispatched" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function shiftDate(daysDelta: number): string {
  const base = new Date(`${currentOperationalDate()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + daysDelta);
  return base.toISOString().slice(0, 10);
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

function previousMonthString(): string {
  const [y, m] = currentOperationalMonth().split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

function formatCellValue(
  value: string | number | boolean | null | undefined,
  format?: string,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (format === "currency") return formatZar(value);
  if (format === "percent" && typeof value === "number") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if ((format === "decimal" || format === "km") && typeof value === "number") {
    return value.toLocaleString("en-ZA", {
      minimumFractionDigits: format === "km" ? 1 : 2,
      maximumFractionDigits: 2,
    });
  }
  if (format === "integer" && typeof value === "number") {
    return value.toLocaleString("en-ZA");
  }
  return String(value);
}

function ReportsPage() {
  const { session } = Route.useRouteContext();
  const availableDatasets = useMemo(
    () =>
      datasetOptions.filter((opt) =>
        opt.permissions.some((p) => can(session, p)),
      ),
    [session],
  );

  const [dataset, setDataset] = useState<ReportDataset>(
    () => availableDatasets[0]?.id ?? "earnings",
  );
  const [month, setMonth] = useState(currentOperationalMonth);
  const [from, setFrom] = useState(() => monthBounds(currentOperationalMonth()).from);
  const [to, setTo] = useState(() => monthBounds(currentOperationalMonth()).to);
  const [truckId, setTruckId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [kind, setKind] = useState("");
  const [review, setReview] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [includeVoid, setIncludeVoid] = useState(false);

  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");

  const activeDataset = availableDatasets.some((d) => d.id === dataset)
    ? dataset
    : (availableDatasets[0]?.id ?? "earnings");

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: availableDatasets.length > 0,
  });

  const filters = useMemo<Record<string, string | boolean | undefined>>(() => {
    switch (activeDataset) {
      case "earnings":
        return {
          month,
          truckId: truckId || undefined,
        };
      case "activities":
        return {
          from: from || undefined,
          to: to || undefined,
          truckId: truckId || undefined,
          driverId: driverId || undefined,
          customerId: customerId || undefined,
          productId: productId || undefined,
          kind: kind || undefined,
          review: review || undefined,
          flagged: flaggedOnly || undefined,
        };
      case "expenses":
        return {
          from: from || undefined,
          to: to || undefined,
          truckId: truckId || undefined,
          category: category || undefined,
          source: source || undefined,
          includeVoid: includeVoid || undefined,
        };
      case "shifts":
        return {
          from: from || undefined,
          to: to || undefined,
          truckId: truckId || undefined,
          driverId: driverId || undefined,
          flagged: flaggedOnly || undefined,
        };
      case "dispatches":
        return {
          from: from || undefined,
          to: to || undefined,
          truckId: truckId || undefined,
          driverId: driverId || undefined,
          customerId: customerId || undefined,
          status: status || undefined,
        };
    }
  }, [
    activeDataset,
    month,
    from,
    to,
    truckId,
    driverId,
    customerId,
    productId,
    kind,
    review,
    category,
    source,
    status,
    flaggedOnly,
    includeVoid,
  ]);

  const previewQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "report-preview",
      activeDataset,
      filters,
    ],
    queryFn: () => getReportPreview(activeDataset, filters),
    enabled: availableDatasets.length > 0,
  });

  if (availableDatasets.length === 0) {
    return (
      <PageError message="You do not have access to any exportable reports." />
    );
  }

  function applyPreset(preset: "this_month" | "last_month" | "last_7" | "last_30" | "all") {
    if (preset === "this_month") {
      const m = currentOperationalMonth();
      const b = monthBounds(m);
      setMonth(m);
      setFrom(b.from);
      setTo(b.to);
    } else if (preset === "last_month") {
      const m = previousMonthString();
      const b = monthBounds(m);
      setMonth(m);
      setFrom(b.from);
      setTo(b.to);
    } else if (preset === "last_7") {
      setFrom(shiftDate(-6));
      setTo(currentOperationalDate());
    } else if (preset === "last_30") {
      setFrom(shiftDate(-29));
      setTo(currentOperationalDate());
    } else {
      setFrom("");
      setTo("");
    }
  }

  function resetFilters() {
    const m = currentOperationalMonth();
    const b = monthBounds(m);
    setMonth(m);
    setFrom(b.from);
    setTo(b.to);
    setTruckId("");
    setDriverId("");
    setCustomerId("");
    setProductId("");
    setKind("");
    setReview("");
    setCategory("");
    setSource("");
    setStatus("");
    setFlaggedOnly(false);
    setIncludeVoid(false);
  }

  async function handleDownload(format: ReportFormat) {
    setExporting(format);
    setExportError("");
    setExportMessage("");
    try {
      const filename = await downloadReportFile(activeDataset, format, filters);
      setExportMessage(`Downloaded ${filename}`);
    } catch (cause) {
      setExportError(
        cause instanceof Error ? cause.message : "Could not export report.",
      );
    } finally {
      setExporting(null);
    }
  }

  const preview = previewQuery.data;
  const trucks = catalogueQuery.data?.trucks ?? [];
  const drivers = catalogueQuery.data?.drivers ?? [];
  const customers = catalogueQuery.data?.customers ?? [];
  const products = catalogueQuery.data?.products ?? [];

  return (
    <>
      <PageHeader
        title="Reports & exports"
        group="Finance & review"
        description="Build filter-based reports, preview totals live, and download formatted Excel workbooks or clean CSV files."
        actions={
          <>
            <RefreshButton
              busy={previewQuery.isFetching}
              onRefresh={() => void previewQuery.refetch()}
            />
            <Button
              variant="outline"
              aria-busy={exporting === "csv"}
              disabled={exporting !== null || previewQuery.isPending}
              onClick={() => void handleDownload("csv")}
            >
              {exporting === "csv" ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Download aria-hidden="true" className="size-4" />
              )}
              <span>CSV (.csv)</span>
            </Button>
            <Button
              aria-busy={exporting === "xlsx"}
              disabled={exporting !== null || previewQuery.isPending}
              onClick={() => void handleDownload("xlsx")}
            >
              {exporting === "xlsx" ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet aria-hidden="true" className="size-4" />
              )}
              <span>Excel (.xlsx)</span>
            </Button>
          </>
        }
      />

      {exportMessage && (
        <Alert role="status">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{exportMessage}</span>
            <button
              type="button"
              onClick={() => setExportMessage("")}
              aria-label="Dismiss notification"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </AlertDescription>
        </Alert>
      )}
      {exportError && <PageError message={exportError} />}

      {/* Step 1: Report dataset selector */}
      <section aria-labelledby="report-dataset-heading" className="space-y-2.5">
        <h2
          id="report-dataset-heading"
          className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
        >
          1. Choose report
        </h2>
        <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
          {availableDatasets.map((opt) => {
            const selected = opt.id === activeDataset;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setDataset(opt.id);
                  setExportMessage("");
                  setExportError("");
                }}
                className={cn(
                  "flex flex-col justify-between gap-2 rounded-xl border bg-background p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "border-foreground ring-1 ring-foreground"
                    : "hover:border-ring",
                )}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{opt.title}</span>
                    {selected && (
                      <Badge className="h-5 px-1.5 text-[10px]">Selected</Badge>
                    )}
                  </div>
                  <p className="text-xs leading-4 text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  {opt.sheets}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Step 2: Filter builder */}
      <Card className="gap-0 py-0 shadow-none">
        <CardHeader className="flex flex-col gap-3 border-b py-3.5 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <div className="flex items-center gap-2">
            <Calendar
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <CardTitle className="text-sm">2. Filter criteria</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {activeDataset === "earnings" ? (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant={
                    month === currentOperationalMonth() ? "default" : "outline"
                  }
                  onClick={() => applyPreset("this_month")}
                >
                  This month
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={
                    month === previousMonthString() ? "default" : "outline"
                  }
                  onClick={() => applyPreset("last_month")}
                >
                  Last month
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => applyPreset("last_7")}
                >
                  Last 7 days
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => applyPreset("last_30")}
                >
                  Last 30 days
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => applyPreset("this_month")}
                >
                  This month
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => applyPreset("last_month")}
                >
                  Last month
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => applyPreset("all")}
                >
                  All dates
                </Button>
              </>
            )}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={resetFilters}
              className="text-muted-foreground"
            >
              <RotateCcw aria-hidden="true" className="size-3" />
              Reset
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-3 p-4 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @md:items-end">
          {activeDataset === "earnings" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rep-month" className="text-xs">
                Operational month (SAST)
              </Label>
              <Input
                id="rep-month"
                type="month"
                className="h-10 text-xs"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 @md:contents">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rep-from" className="text-xs">
                  From date
                </Label>
                <Input
                  id="rep-from"
                  type="date"
                  className="h-10 text-xs"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rep-to" className="text-xs">
                  To date
                </Label>
                <Input
                  id="rep-to"
                  type="date"
                  className="h-10 text-xs"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rep-truck" className="text-xs">
              Vehicle
            </Label>
            <select
              id="rep-truck"
              className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
            >
              <option value="">All vehicles</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.registration} · {t.identifier}
                </option>
              ))}
            </select>
          </div>

          {(activeDataset === "activities" ||
            activeDataset === "shifts" ||
            activeDataset === "dispatches") && (
            <div className="space-y-1.5">
              <Label htmlFor="rep-driver" className="text-xs">
                Driver
              </Label>
              <select
                id="rep-driver"
                className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">All drivers</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.identifier})
                  </option>
                ))}
              </select>
            </div>
          )}

          {(activeDataset === "activities" ||
            activeDataset === "dispatches") && (
            <div className="space-y-1.5">
              <Label htmlFor="rep-customer" className="text-xs">
                Customer
              </Label>
              <select
                id="rep-customer"
                className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">All customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeDataset === "activities" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rep-product" className="text-xs">
                  Product
                </Label>
                <select
                  id="rep-product"
                  className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">All products</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rep-kind" className="text-xs">
                  Activity type
                </Label>
                <select
                  id="rep-kind"
                  className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="">All types</option>
                  {(Object.keys(activityKindLabels) as ActivityKind[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {activityKindLabels[k]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rep-review" className="text-xs">
                  Review status
                </Label>
                <select
                  id="rep-review"
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

          {activeDataset === "expenses" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rep-category" className="text-xs">
                  Expense category
                </Label>
                <select
                  id="rep-category"
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
              <div className="space-y-1.5">
                <Label htmlFor="rep-source" className="text-xs">
                  Source
                </Label>
                <select
                  id="rep-source"
                  className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">All sources</option>
                  {expenseSources.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex h-10 items-center gap-2 text-xs">
                <Checkbox
                  checked={includeVoid}
                  onCheckedChange={(v) => setIncludeVoid(Boolean(v))}
                />
                Include voided entries
              </label>
            </>
          )}

          {activeDataset === "dispatches" && (
            <div className="space-y-1.5">
              <Label htmlFor="rep-status" className="text-xs">
                Dispatch status
              </Label>
              <select
                id="rep-status"
                className="h-10 w-full rounded-lg border border-input bg-background pl-3.5 pr-10 text-xs"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {dispatchStatuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(activeDataset === "activities" || activeDataset === "shifts") && (
            <label className="flex h-10 items-center gap-2 text-xs">
              <Checkbox
                checked={flaggedOnly}
                onCheckedChange={(v) => setFlaggedOnly(Boolean(v))}
              />
              Flagged / exceptions only
            </label>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Live Report Preview */}
      {previewQuery.error && <PageError message={previewQuery.error.message} />}

      {previewQuery.isPending ? (
        <ReportPreviewSkeleton />
      ) : preview ? (
        <section aria-labelledby="report-preview-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id="report-preview-heading"
                className="text-sm font-semibold"
              >
                3. Live preview · {preview.title}
              </h2>
              {preview.activeFilters.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {preview.activeFilters.map((f) => (
                    <Badge
                      key={`${f.label}-${f.value}`}
                      variant="secondary"
                      className="text-[11px] font-normal"
                    >
                      <span className="text-muted-foreground">{f.label}:</span>{" "}
                      <span className="ml-1 font-medium">{f.value}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {preview.totalRows.toLocaleString("en-ZA")} matching row
              {preview.totalRows === 1 ? "" : "s"}
            </p>
          </div>

          {preview.kpis.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-4">
              {preview.kpis.slice(0, 8).map((kpi) => (
                <Card
                  key={kpi.label}
                  className="min-w-0 gap-1 p-3.5 py-3.5 shadow-none"
                >
                  <p className="text-[11px] leading-4 text-muted-foreground uppercase">
                    {kpi.label}
                  </p>
                  <p className="truncate text-lg font-semibold tabular-nums">
                    {kpi.value}
                  </p>
                  {kpi.hint && (
                    <p className="truncate text-xs text-muted-foreground">
                      {kpi.hint}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}

          <Card className="gap-0 overflow-hidden py-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 border-b py-3.5">
              <CardTitle className="text-sm">Data preview</CardTitle>
              {preview.truncated && (
                <span className="text-xs text-muted-foreground">
                  Showing first {preview.rows.length} of{" "}
                  {preview.totalRows.toLocaleString("en-ZA")} rows · export
                  includes all rows
                </span>
              )}
            </CardHeader>

            {preview.rows.length === 0 ? (
              <EmptyState
                icon="download"
                title="No rows match these filters"
                description="Adjust the date range or clear one of the filters above to see matching records."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {preview.columns.map((col) => {
                        const numeric = [
                          "currency",
                          "decimal",
                          "km",
                          "integer",
                          "percent",
                        ].includes(col.format ?? "");
                        return (
                          <TableHead
                            key={col.key}
                            className={cn(
                              "whitespace-nowrap text-xs",
                              numeric && "text-right",
                            )}
                          >
                            {col.header}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row, idx) => (
                      <TableRow key={idx}>
                        {preview.columns.map((col) => {
                          const numeric = [
                            "currency",
                            "decimal",
                            "km",
                            "integer",
                            "percent",
                          ].includes(col.format ?? "");
                          return (
                            <TableCell
                              key={col.key}
                              className={cn(
                                "max-w-[260px] truncate text-xs",
                                numeric && "text-right tabular-nums",
                              )}
                              title={String(row[col.key] ?? "")}
                            >
                              {formatCellValue(row[col.key], col.format)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </section>
      ) : null}
    </>
  );
}
