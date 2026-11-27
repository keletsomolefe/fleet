import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { EarningsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
import { ExportMenu } from "@/components/export-menu";
import { RefreshButton } from "@/components/refresh-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  currentOperationalMonth,
  expenseCategoryLabels,
  formatZar,
  getMonthlyEarnings,
  getTransportCatalogue,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/earnings")({
  loader: async ({ context }) => {
    if (!can(context.session, "revenue.read")) return;
    const month = currentOperationalMonth();
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
          "monthly-earnings",
          month,
          "",
        ],
        queryFn: () => getMonthlyEarnings(month, undefined),
      }),
    ]);
  },
  component: EarningsPage,
});

function EarningsPage() {
  const { session } = Route.useRouteContext();
  const readable = can(session, "revenue.read");
  const [month, setMonth] = useState(currentOperationalMonth());
  const [truckId, setTruckId] = useState("");

  const catalogueQuery = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const reportQuery = useQuery({
    queryKey: [
      ...adminOperationsKey(session.user.id),
      "transport-earnings",
      { month, truckId },
    ],
    queryFn: () => getMonthlyEarnings(month, truckId || undefined),
    enabled: readable && /^\d{4}-\d{2}$/.test(month),
  });

  if (!readable) {
    return <PageError message="You do not have access to Truck earnings." />;
  }

  const report = reportQuery.data;

  return (
    <>
      <PageHeader
        title="Truck earnings"
        group="Finance & review"
        description="Month-end revenue estimates, petrol & repair spending, tonnage moved, km driven, and estimated net margin per vehicle."
        actions={
          <>
            <RefreshButton
              busy={reportQuery.isFetching}
              onRefresh={() => void reportQuery.refetch()}
            />
            <ExportMenu
              dataset="earnings"
              filters={{ month, truckId: truckId || undefined }}
            />
          </>
        }
      />

      <Card className="gap-0 py-0 shadow-none">
        <CardContent className="grid grid-cols-2 gap-3 p-3.5 @lg:grid-cols-3 @lg:items-end @lg:p-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="earn-month" className="text-xs">
              Month (SAST)
            </Label>
            <Input
              id="earn-month"
              type="month"
              className="h-10 text-xs"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="earn-truck" className="text-xs">
              Vehicle
            </Label>
            <select
              id="earn-truck"
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
          {report && (
            <p className="col-span-2 text-xs text-muted-foreground tabular-nums @lg:col-span-1 @lg:text-right">
              {report.summary.deliveries} deliveries ·{" "}
              {Number(report.summary.tonnesDelivered).toLocaleString("en-ZA")} t ·{" "}
              {Number(report.summary.kmDriven).toLocaleString("en-ZA")} km
            </p>
          )}
        </CardContent>
      </Card>

      {reportQuery.error && <PageError message={reportQuery.error.message} />}

      {reportQuery.isPending ? (
        <EarningsSkeleton />
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-3 @5xl:grid-cols-5">
            <Card className="min-w-0 gap-1 p-3.5 py-3.5 shadow-none @md:p-4 @md:py-4">
              <p className="text-[11px] uppercase text-muted-foreground">
                Estimated revenue
              </p>
              <p className="truncate text-lg font-semibold tabular-nums @md:text-xl @2xl:text-2xl">
                {formatZar(report.summary.revenue)}
              </p>
              <p className="text-xs text-muted-foreground">
                Validated: {formatZar(report.summary.validated)}
                {report.summary.unpriced > 0
                  ? ` · ${report.summary.unpriced} unpriced`
                  : ""}
              </p>
            </Card>
            <Card className="min-w-0 gap-1 p-3.5 py-3.5 shadow-none @md:p-4 @md:py-4">
              <p className="text-[11px] uppercase text-muted-foreground">
                Petrol / fuel spend
              </p>
              <p className="truncate text-lg font-semibold tabular-nums @md:text-xl @2xl:text-2xl">
                {formatZar(report.summary.fuelSpend)}
              </p>
              <p className="text-xs text-muted-foreground">
                {Number(report.summary.fuelLitres).toLocaleString("en-ZA")} L
                {report.summary.avgFuelPricePerLitre
                  ? ` · R${report.summary.avgFuelPricePerLitre}/L`
                  : ""}
              </p>
            </Card>
            <Card className="min-w-0 gap-1 p-3.5 py-3.5 shadow-none @md:p-4 @md:py-4">
              <p className="text-[11px] uppercase text-muted-foreground">
                Repairs & service
              </p>
              <p className="truncate text-lg font-semibold tabular-nums @md:text-xl @2xl:text-2xl">
                {formatZar(report.summary.repairSpend)}
              </p>
              <p className="text-xs text-muted-foreground">
                Includes {report.summary.serviceJobCount} breakdown job
                {report.summary.serviceJobCount === 1 ? "" : "s"} + workshop
              </p>
            </Card>
            <Card className="min-w-0 gap-1 p-3.5 py-3.5 shadow-none @md:p-4 @md:py-4">
              <p className="text-[11px] uppercase text-muted-foreground">
                Other spend
              </p>
              <p className="truncate text-lg font-semibold tabular-nums @md:text-xl @2xl:text-2xl">
                {formatZar(report.summary.otherExpenseSpend)}
              </p>
              <p className="text-xs text-muted-foreground">
                Tolls, weighbridge, permits, insurance
              </p>
            </Card>
            <Card className="col-span-2 min-w-0 gap-1 p-3.5 py-3.5 shadow-none @md:p-4 @md:py-4 @2xl:col-span-1">
              <p className="text-[11px] uppercase text-muted-foreground">
                Estimated net margin
              </p>
              <p className="truncate text-lg font-semibold tabular-nums @md:text-xl @2xl:text-2xl">
                {formatZar(report.summary.estimatedNetMargin)}
              </p>
              <p className="text-xs text-muted-foreground">
                Total spend: {formatZar(report.summary.totalSpend)}
              </p>
            </Card>
          </div>

          <Card className="gap-0 overflow-hidden py-0 shadow-none">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Per-vehicle performance</CardTitle>
            </CardHeader>
            {report.totals.length === 0 ? (
              <EmptyState
                icon="truck"
                title="No activity recorded for this month"
                description="Completed deliveries, petrol purchases, shift mileage and repair jobs for this month appear here."
              />
            ) : (
              <>
                <ul className="divide-y @3xl:hidden">
                  {report.totals.map((row) => (
                    <li key={row.truckId} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">{row.registration}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.truckName}
                            {row.kmPerLitre ? ` · ${row.kmPerLitre} km/L` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] uppercase text-muted-foreground">
                            Est. margin
                          </p>
                          <p className="text-sm font-semibold tabular-nums">
                            {formatZar(row.estimatedNetMargin)}
                          </p>
                        </div>
                      </div>
                      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
                        <div>
                          <dt className="text-[10px] uppercase text-muted-foreground">
                            Revenue
                          </dt>
                          <dd className="font-medium tabular-nums">
                            {formatZar(row.revenue)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase text-muted-foreground">
                            Fuel
                          </dt>
                          <dd className="tabular-nums">
                            {formatZar(row.fuelSpend)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase text-muted-foreground">
                            Repairs/Other
                          </dt>
                          <dd className="tabular-nums">
                            {formatZar(
                              Number(row.repairSpend) +
                                Number(row.otherExpenseSpend),
                            )}
                          </dd>
                        </div>
                      </dl>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {row.deliveries} load{row.deliveries === 1 ? "" : "s"} ·{" "}
                        {Number(row.tonnesDelivered).toLocaleString("en-ZA")} t ·{" "}
                        {Number(row.kmDriven).toLocaleString("en-ZA")} km
                        {row.revenuePerKm ? ` · R${row.revenuePerKm}/km` : ""}
                        {row.unpriced > 0 ? ` · ${row.unpriced} unpriced` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto @3xl:block">
                  <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle</TableHead>
                      <TableHead className="text-right">Loads</TableHead>
                      <TableHead className="text-right">Tonnes</TableHead>
                      <TableHead className="text-right">km</TableHead>
                      <TableHead className="text-right">Est. Revenue</TableHead>
                      <TableHead className="text-right">Fuel</TableHead>
                      <TableHead className="text-right">Repairs</TableHead>
                      <TableHead className="text-right">Other</TableHead>
                      <TableHead className="text-right">Est. Margin</TableHead>
                      <TableHead className="text-right">R/km</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.totals.map((row) => (
                      <TableRow key={row.truckId}>
                        <TableCell>
                          <p className="font-semibold">{row.registration}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.truckName}
                            {row.kmPerLitre ? ` · ${row.kmPerLitre} km/L` : ""}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.deliveries}
                          {row.unpriced > 0 && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              {row.unpriced} unpriced
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(row.tonnesDelivered).toLocaleString("en-ZA")}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(row.kmDriven).toLocaleString("en-ZA")}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatZar(row.revenue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatZar(row.fuelSpend)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatZar(row.repairSpend)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatZar(row.otherExpenseSpend)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatZar(row.estimatedNetMargin)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {row.revenuePerKm ? `R${row.revenuePerKm}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">By customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {report.byCustomer.length === 0 ? (
                  <p className="text-muted-foreground">No customer deliveries yet.</p>
                ) : (
                  report.byCustomer.map((item, i) => (
                    <div
                      key={`${item.truckId}-${item.name}-${i}`}
                      className="flex items-center justify-between border-b pb-2 last:border-b-0"
                    >
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-muted-foreground">
                          {item.deliveries} loads · {Number(item.tonnes).toFixed(1)} t
                        </p>
                      </div>
                      <p className="font-semibold">{formatZar(item.amount)}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">By product</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {report.byProduct.length === 0 ? (
                  <p className="text-muted-foreground">No product deliveries yet.</p>
                ) : (
                  report.byProduct.map((item, i) => (
                    <div
                      key={`${item.truckId}-${item.name}-${i}`}
                      className="flex items-center justify-between border-b pb-2 last:border-b-0"
                    >
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-muted-foreground">
                          {item.deliveries} loads · {Number(item.tonnes).toFixed(1)} t
                        </p>
                      </div>
                      <p className="font-semibold">{formatZar(item.amount)}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Spend by category</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {report.byExpenseCategory.length === 0 ? (
                  <p className="text-muted-foreground">No expenses recorded yet.</p>
                ) : (
                  report.byExpenseCategory.map((item) => (
                    <div
                      key={item.category}
                      className="flex items-center justify-between border-b pb-2 last:border-b-0"
                    >
                      <div>
                        <p className="font-medium">
                          {expenseCategoryLabels[item.category] ?? item.category}
                        </p>
                        <p className="text-muted-foreground">
                          {item.count} {item.count === 1 ? "entry" : "entries"}
                        </p>
                      </div>
                      <p className="font-semibold">{formatZar(item.amount)}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
