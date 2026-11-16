import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageError } from "@/components/page-error";
import { PageHeader, BackLink } from "@/components/page-header";
import { ServiceProviderForm } from "@/components/service-provider-form";
import { JobStatusBadge, ServiceTypeBadge } from "@/components/service-job-bits";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import { displayDate } from "@/lib/fleet";
import {
  getProvider,
  serviceTypeLabels,
} from "@/lib/service-jobs";

export const Route = createFileRoute("/admin/providers/$providerId")({
  component: Page,
});
function Page() {
  const { session } = Route.useRouteContext();
  const { providerId } = Route.useParams();
  const writable = can(session, "service_providers.write");
  const { data, error, isPending } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "provider", providerId],
    queryFn: () => getProvider(providerId),
    refetchInterval: 30_000,
  });
  if (error) return <PageError message={error.message} />;
  if (isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading service provider…
      </p>
    );
  if (!data) return <PageError message="Service provider not found." />;
  if (!writable)
    return (
      <>
        <PageHeader
          back={<BackLink to="/admin/providers">Service providers</BackLink>}
          title={data.provider.companyName}
          group="Operations"
          description={`${data.provider.contactName} · ${data.provider.whatsappNumber}`}
        />
        <Card className="max-w-3xl gap-4 p-4 shadow-none sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {data.provider.status === "active" ? "Active" : "Paused"}
            </Badge>
            <Badge variant={data.provider.alertsEnabled ? "outline" : "destructive"}>
              {data.provider.alertsEnabled
                ? "WhatsApp alerts on"
                : data.provider.optedOutAt
                  ? "Opted out"
                  : "WhatsApp alerts off"}
            </Badge>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Contact</dt>
              <dd>{data.provider.contactName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">WhatsApp</dt>
              <dd>{data.provider.whatsappNumber}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Phone</dt>
              <dd>{data.provider.phone ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd>{data.provider.email ?? "Not recorded"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Services</dt>
              <dd>
                {data.provider.services.length
                  ? data.provider.services
                      .map((service) => serviceTypeLabels[service])
                      .join(", ")
                  : "Not recorded"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Coverage</dt>
              <dd>{data.provider.coverageArea ?? "Not recorded"}</dd>
            </div>
            {data.provider.optOutReason && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Opt-out</dt>
                <dd>{data.provider.optOutReason}</dd>
              </div>
            )}
          </dl>
        </Card>
        {can(session, "service_jobs.read") && <ProviderRecentJobs jobs={data.jobs} />}
      </>
    );
  return (
    <>
      <ServiceProviderForm session={session} provider={data.provider} />
      {can(session, "service_jobs.read") && <ProviderRecentJobs jobs={data.jobs} />}
    </>
  );
}

function ProviderRecentJobs({ jobs }: { jobs: import("@/lib/service-jobs").JobListRow[] }) {
  return (
    <section className="mt-6 max-w-3xl space-y-3">
      <h2 className="text-sm font-semibold">Recent jobs</h2>
      {!jobs.length ? (
        <Card className="py-0 shadow-none">
          <EmptyState icon="wrench" title="No jobs handled yet" />
        </Card>
      ) : (
        <Card className="gap-0 divide-y py-0 shadow-none">
          {jobs.map((job) => (
            <Link
              key={job.id}
              to="/admin/jobs/$jobId"
              params={{ jobId: job.id }}
              className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <div className="space-y-1">
                <p className="font-semibold">{job.reference}</p>
                <p className="text-xs text-muted-foreground">
                  {job.truck
                    ? `${job.truck.registration} · ${job.truck.identifier}`
                    : "Vehicle not recorded"}{" "}
                  · {displayDate(job.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ServiceTypeBadge type={job.serviceType} />
                <JobStatusBadge status={job.status} stage={job.latestStage} />
              </div>
            </Link>
          ))}
        </Card>
      )}
    </section>
  );
}
