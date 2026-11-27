import {
  createFileRoute,
  Link,
  linkOptions,
  redirect,
} from "@tanstack/react-router";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { KpiCardsSkeleton } from "@/components/page-skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can, type AdminSession } from "@/lib/auth";
import { getJobCounts } from "@/lib/service-jobs";
import {
  currentOperationalMonth,
  formatZar,
  getMonthlyEarnings,
} from "@/lib/transport";
import { deniedPage } from "@/lib/users";

export const Route = createFileRoute("/admin/")({
  loader: async ({ context }) => {
    if (!can(context.session, "overview.read")) {
      if (can(context.session, "issues.read"))
        throw redirect({ to: "/admin/vehicle-disputes" });
      return deniedPage();
    }
    const month = currentOperationalMonth();
    const tasks: Array<Promise<unknown>> = [];
    if (can(context.session, "revenue.read")) {
      tasks.push(
        context.queryClient.ensureQueryData({
          queryKey: [
            ...adminOperationsKey(context.session.user.id),
            "overview-earnings",
            month,
          ],
          queryFn: () => getMonthlyEarnings(month),
        }),
      );
    }
    if (can(context.session, "service_jobs.read")) {
      tasks.push(
        context.queryClient.ensureQueryData({
          queryKey: [
            ...adminOperationsKey(context.session.user.id),
            "job-summary",
          ],
          queryFn: getJobCounts,
        }),
      );
    }
    await Promise.allSettled(tasks);
    return { denied: false };
  },
  component: Overview,
});

const shortcuts = [
  {
    title: "Dispatch",
    description: "Plan and dispatch pickup & delivery loads to drivers.",
    icon: "dispatch",
    permissions: ["dispatch.read"],
    link: linkOptions({ to: "/admin/dispatch" }),
  },
  {
    title: "Driver activity",
    description: "Inspect collections, deliveries, fuel, expenses and journey timeline.",
    icon: "activity",
    permissions: ["activities.read"],
    link: linkOptions({ to: "/admin/activities" }),
  },
  {
    title: "Shifts & mileage",
    description: "Review start/end odometer readings, photos and km driven.",
    icon: "clock",
    permissions: ["shifts.read"],
    link: linkOptions({ to: "/admin/shifts" }),
  },
  {
    title: "Truck earnings",
    description: "Month-end revenue estimates, petrol, repairs and margin.",
    icon: "download",
    permissions: ["revenue.read"],
    link: linkOptions({ to: "/admin/earnings" }),
  },
  {
    title: "Service jobs",
    description: "See breakdowns and who is handling them.",
    icon: "wrench",
    permissions: ["service_jobs.read"],
    link: linkOptions({
      to: "/admin/jobs",
      search: { q: "", page: 1, status: "active", providerId: "" },
    }),
  },
  {
    title: "Exceptions",
    description: "Review reports that need attention.",
    icon: "alert",
    permissions: ["issues.read"],
    link: linkOptions({ to: "/admin/vehicle-disputes" }),
  },
  {
    title: "Driver schedule",
    description: "Plan which drivers use each vehicle.",
    icon: "clock",
    permissions: [
      "drivers.read",
      "drivers.write",
      "trucks.read",
      "trucks.write",
    ],
    link: linkOptions({ to: "/admin/schedules" }),
  },
  {
    title: "Vehicles",
    description: "Find a vehicle by registration or fleet number.",
    icon: "truck",
    permissions: ["trucks.read"],
    link: linkOptions({
      to: "/admin/trucks",
      search: { q: "", page: 1, status: "" },
    }),
  },
  {
    title: "Drivers",
    description: "Find a driver and view their details.",
    icon: "users",
    permissions: ["drivers.read"],
    link: linkOptions({
      to: "/admin/drivers",
      search: { q: "", page: 1, status: "" },
    }),
  },
];

function Overview() {
  const { session } = Route.useRouteContext();
  if (Route.useLoaderData().denied)
    return <PageError message="You do not have access to this page." />;
  const available = shortcuts.filter(({ permissions }) =>
    permissions.every((permission) => can(session, permission)),
  );
  const canExportReports = [
    "revenue.read",
    "activities.read",
    "expenses.read",
    "shifts.read",
    "dispatch.read",
  ].some((permission) => can(session, permission));
  return (
    <>
      <PageHeader
        title="Fleet overview"
        actions={
          canExportReports ? (
            <Button variant="outline" asChild>
              <Link to="/admin/reports">
                <FileSpreadsheet aria-hidden="true" className="size-4" />
                Reports &amp; exports
              </Link>
            </Button>
          ) : undefined
        }
      />
      <MonthlyFinancePanel session={session} />
      <ServiceJobsPanel session={session} />
      {available.length > 0 ? (
        <nav aria-labelledby="fleet-shortcuts" className="space-y-3">
          <h2 id="fleet-shortcuts" className="text-sm font-semibold">
            Fleet shortcuts
          </h2>
          <ul className="grid grid-cols-1 gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
            {available.map(({ title, description, icon, link }) => {
              const descId = `shortcut-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
              return (
              <li key={title} className="min-w-0">
                <Link
                  {...link}
                  aria-label={title}
                  aria-describedby={descId}
                  className="group block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Card className="h-full gap-0 py-0 shadow-none group-hover:border-ring">
                    <CardContent className="flex flex-col gap-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
                          <img
                            src={`/design/${icon}.svg`}
                            alt=""
                            width={20}
                            height={20}
                            className="size-5 shrink-0 brightness-0"
                          />
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="font-semibold">{title}</p>
                        <p
                          id={descId}
                          className="text-xs leading-5 text-muted-foreground"
                        >
                          {description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
              );
            })}
          </ul>
        </nav>
      ) : (
        <Card className="py-0 shadow-none">
          <EmptyState icon="overview" title="No fleet sections available" />
        </Card>
      )}
    </>
  );
}


function MonthlyFinancePanel({ session }: { session: AdminSession }) {
  const allowed = can(session, "revenue.read");
  const month = currentOperationalMonth();
  const { data, isPending } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "overview-earnings", month],
    queryFn: () => getMonthlyEarnings(month),
    enabled: allowed,
    refetchInterval: 30_000,
  });
  if (!allowed) return null;
  return (
    <section aria-labelledby="finance-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="finance-heading" className="text-sm font-semibold">
          This month ({month})
        </h2>
        <Link
          to="/admin/earnings"
          className="text-xs underline underline-offset-4"
        >
          Open truck earnings
        </Link>
      </div>
      {isPending ? (
        <KpiCardsSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
          {[
            ["Est. revenue", data ? formatZar(data.summary.revenue) : "—"],
            ["Fuel spend", data ? formatZar(data.summary.fuelSpend) : "—"],
            [
              "Repairs & spend",
              data
                ? formatZar(
                    Number(data.summary.repairSpend) +
                      Number(data.summary.otherExpenseSpend),
                  )
                : "—",
            ],
            [
              "Est. net margin",
              data ? formatZar(data.summary.estimatedNetMargin) : "—",
            ],
          ].map(([label, value]) => (
            <Link
              key={String(label)}
              to="/admin/earnings"
              className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Card className="h-full min-w-0 gap-1 p-4 py-4 shadow-none hover:border-ring">
                <p className="text-[11px] leading-4 text-muted-foreground uppercase">
                  {label}
                </p>
                <p className="truncate text-lg font-semibold tabular-nums @xl:text-xl">
                  {value}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ServiceJobsPanel({ session }: { session: AdminSession }) {
  const allowed = can(session, "service_jobs.read");
  const { data, isPending, error } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "job-summary"],
    queryFn: getJobCounts,
    enabled: allowed,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  if (!allowed) return null;
  return (
    <section aria-labelledby="service-jobs-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="service-jobs-heading" className="text-sm font-semibold">
          Service jobs
        </h2>
        <Link
          to="/admin/jobs"
          search={{ q: "", page: 1, status: "active", providerId: "" }}
          className="text-xs underline underline-offset-4"
        >
          Open service jobs
        </Link>
      </div>
      {isPending ? (
        <KpiCardsSkeleton
          count={3}
          className="grid grid-cols-1 gap-3 @lg:grid-cols-3"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-3">
          {[
            ["Waiting for provider", data?.waiting, "waiting"],
            ["In progress", data?.working, "working"],
            ["Awaiting office check", data?.awaitingClose, "awaiting"],
          ].map(([label, value, status]) => (
            <Link
              key={String(label)}
              to="/admin/jobs"
              search={{
                q: "",
                page: 1,
                status: String(status),
                providerId: "",
              }}
              className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Card className="h-full min-w-0 gap-1 p-4 py-4 shadow-none hover:border-ring">
                <p className="text-[11px] leading-4 text-muted-foreground uppercase">
                  {label}
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {value ?? "—"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Could not load service job counts. Refresh to try again.
        </p>
      )}
    </section>
  );
}
