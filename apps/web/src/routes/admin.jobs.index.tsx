import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import {
  createFileRoute,
  Link,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, Search as SearchIcon } from "lucide-react";
import { PageHeader, CreateAction } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
import { RefreshButton } from "@/components/refresh-button";
import {
  JobStatusBadge,
  JobSummaryCards,
  ServiceTypeBadge,
} from "@/components/service-job-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import { displayDate } from "@/lib/fleet";
import { submitForm, textFieldProps } from "@/lib/form";
import {
  elapsed,
  getJobs,
  jobSearchDefaults,
  validateJobSearch,
} from "@/lib/service-jobs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/jobs/")({
  validateSearch: validateJobSearch,
  search: { middlewares: [stripSearchParams(jobSearchDefaults)] },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    if (!can(context.session, "service_jobs.read")) return;
    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "jobs",
          deps,
        ],
        queryFn: () => getJobs(deps),
      }),
    ]);
  },
  component: Page,
});

const tabs = [
  { value: "active", label: "Active" },
  { value: "waiting", label: "Waiting" },
  { value: "working", label: "In progress" },
  { value: "awaiting", label: "Awaiting check" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

function Page() {
  const { session } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/jobs/" });
  const writable = can(session, "service_jobs.write");
  const form = useForm({
    defaultValues: { q: search.q },
    onSubmit: ({ value }) =>
      void navigate({
        search: { ...search, q: value.q.trim(), page: 1 },
      }),
  });
  useEffect(() => form.reset({ q: search.q }), [form, search.q]);
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "jobs", search],
    queryFn: () => getJobs(search),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  return (
    <>
      <PageHeader
        title="Service jobs"
        group="Operations"
        description="Breakdowns and assistance requests, and who is handling them."
        actions={
          <>
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
            {writable && (
              <CreateAction asChild>
                <Link to="/admin/jobs/new">
                  <Plus /> New job
                </Link>
              </CreateAction>
            )}
          </>
        }
      />
      {data?.counts && <JobSummaryCards counts={data.counts} />}
      {data && !data.alertsReady && (
        <Alert>
          <AlertDescription>
            Provider alerts are not available yet. Service providers will not
            be notified.
          </AlertDescription>
        </Alert>
      )}
      {error && <PageError message={error.message} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Job status" className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Button
              key={tab.value}
              variant={search.status === tab.value ? "default" : "outline"}
              size="sm"
              asChild
            >
              <Link
                to="/admin/jobs"
                search={{ ...search, status: tab.value, page: 1 }}
                aria-current={search.status === tab.value ? "page" : undefined}
              >
                {tab.label}
              </Link>
            </Button>
          ))}
        </nav>
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="border-b p-4 sm:p-5">
          <form
            onSubmit={submitForm(form)}
            role="search"
            className="flex w-full max-w-xl items-center gap-2"
          >
            <form.Field name="q">
              {(field) => (
                <Input
                  {...textFieldProps(field)}
                  aria-label="Search service jobs"
                  placeholder="Job, registration, provider or issue"
                  maxLength={200}
                />
              )}
            </form.Field>
            <Button
              type="submit"
              variant="outline"
              size="icon"
              className="size-12"
              aria-label="Search"
            >
              <SearchIcon aria-hidden="true" />
            </Button>
          </form>
        </div>
        {isPending ? (
          <ListRowsSkeleton rows={5} />
        ) : !error && (!data || !data.items.length) ? (
          <EmptyState
            icon="wrench"
            title={
              search.q || search.status !== "active"
                ? "No matching service jobs"
                : "No service jobs yet"
            }
            description={
              search.q
                ? "Try a different search."
                : "Jobs appear here when a driver reports a breakdown or the office creates one."
            }
            action={
              writable && !search.q ? (
                <CreateAction asChild>
                  <Link to="/admin/jobs/new">
                    <Plus /> New job
                  </Link>
                </CreateAction>
              ) : undefined
            }
          />
        ) : data ? (
          <ul className="divide-y">
            {data.items.map((job) => (
              <li key={job.id}>
                <Link
                  to="/admin/jobs/$jobId"
                  params={{ jobId: job.id }}
                  className="grid gap-3 p-4 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] sm:items-center sm:px-5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{job.reference}</p>
                      <JobStatusBadge
                        status={job.status}
                        stage={job.latestStage}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {job.truck
                        ? `${job.truck.registration} · ${job.truck.identifier}`
                        : "Vehicle not recorded"}
                      {job.driver ? ` · ${job.driver.name}` : ""}
                    </p>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <ServiceTypeBadge type={job.serviceType} />
                    <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]">
                      {job.description}
                    </p>
                  </div>
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className={cn("min-w-0 [overflow-wrap:anywhere]", job.provider ? "" : "text-muted-foreground")}>
                      {job.provider?.companyName ?? "Waiting for provider"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {job.status === "open"
                        ? `Waiting ${elapsed(job.createdAt)}`
                        : `Updated ${displayDate(job.updatedAt)}`}
                    </p>
                  </div>
                  <ArrowRight
                    aria-hidden="true"
                    className="hidden size-4 text-muted-foreground sm:block"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {data && data.total > data.pageSize && (
          <nav
            aria-label="Service job pages"
            className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs sm:px-5"
          >
            <span className="text-muted-foreground">
              Page {data.page} of{" "}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() =>
                  void navigate({ search: { ...search, page: data.page - 1 } })
                }
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() =>
                  void navigate({ search: { ...search, page: data.page + 1 } })
                }
              >
                Next
              </Button>
            </div>
          </nav>
        )}
      </Card>
    </>
  );
}
