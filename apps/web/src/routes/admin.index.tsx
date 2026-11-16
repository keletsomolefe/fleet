import {
  createFileRoute,
  Link,
  linkOptions,
  redirect,
} from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { Card, CardContent } from "@/components/ui/card";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can, type AdminSession } from "@/lib/auth";
import { getJobCounts } from "@/lib/service-jobs";
import { deniedPage } from "@/lib/users";

export const Route = createFileRoute("/admin/")({
  loader: ({ context }) => {
    if (can(context.session, "overview.read")) return { denied: false };
    if (can(context.session, "issues.read"))
      throw redirect({ to: "/admin/vehicle-disputes" });
    return deniedPage();
  },
  component: Overview,
});

const shortcuts = [
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
  return (
    <>
      <PageHeader title="Fleet overview" />
      <ServiceJobsPanel session={session} />
      {available.length > 0 ? (
        <nav aria-labelledby="fleet-shortcuts" className="space-y-3">
          <h2 id="fleet-shortcuts" className="text-sm font-semibold">
            Fleet shortcuts
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {available.map(({ title, description, icon, link }) => (
              <li key={title} className="min-w-0">
                <Link
                  {...link}
                  aria-label={title}
                  aria-describedby={`shortcut-${icon}`}
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
                          id={`shortcut-${icon}`}
                          className="text-xs leading-5 text-muted-foreground"
                        >
                          {description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Card className="h-full gap-1 p-4 py-4 shadow-none hover:border-ring">
              <p className="text-[11px] leading-4 text-muted-foreground uppercase">
                {label}
              </p>
              <p className="text-2xl font-semibold">
                {isPending ? "…" : value ?? "—"}
              </p>
            </Card>
          </Link>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Could not load service job counts. Refresh to try again.
        </p>
      )}
    </section>
  );
}
