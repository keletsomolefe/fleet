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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import { displayDate } from "@/lib/fleet";
import { submitForm, textFieldProps } from "@/lib/form";
import {
  getProviders,
  providerSearchDefaults,
  serviceTypeLabels,
  validateProviderSearch,
} from "@/lib/service-jobs";

export const Route = createFileRoute("/admin/providers/")({
  validateSearch: validateProviderSearch,
  search: { middlewares: [stripSearchParams(providerSearchDefaults)] },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    if (!can(context.session, "service_providers.read")) return;
    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "providers",
          deps,
        ],
        queryFn: () => getProviders(deps),
      }),
    ]);
  },
  component: Page,
});
function Page() {
  const { session } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/providers/" });
  const writable = can(session, "service_providers.write");
  const form = useForm({
    defaultValues: { q: search.q },
    onSubmit: ({ value }) =>
      void navigate({ search: { ...search, q: value.q.trim(), page: 1 } }),
  });
  useEffect(() => form.reset({ q: search.q }), [form, search.q]);
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "providers", search],
    queryFn: () => getProviders(search),
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader
        title="Service providers"
        group="Operations"
        description="Companies and WhatsApp contacts that receive job alerts."
        actions={
          <>
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
            {writable && (
              <CreateAction asChild>
                <Link to="/admin/providers/new">
                  <Plus /> Add provider
                </Link>
              </CreateAction>
            )}
          </>
        }
      />
      {error && <PageError message={error.message} />}
      {data && !data.alertsReady && (
        <Alert><AlertDescription>WhatsApp job alerts are currently unavailable.</AlertDescription></Alert>
      )}
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
          <form
            onSubmit={submitForm(form)}
            role="search"
            className="flex w-full max-w-xl items-center gap-2"
          >
            <form.Field name="q">
              {(field) => (
                <Input
                  {...textFieldProps(field)}
                  aria-label="Search service providers"
                  placeholder="Company, contact or WhatsApp number"
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
          <select
            aria-label="Filter provider status"
            value={search.status}
            onChange={(event) =>
              void navigate({
                search: {
                  ...search,
                  q: form.getFieldValue("q"),
                  page: 1,
                  status: event.currentTarget.value,
                },
              })
            }
            className="h-12 rounded-md border bg-background pl-3.5 pr-10 text-sm"
          >
            <option value="">All providers</option>
            <option value="receives_alerts">Receives alerts</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="alerts_off">Alerts off</option>
          </select>
        </div>
        {isPending ? (
          <ListRowsSkeleton rows={4} />
        ) : !error && (!data || !data.items.length) ? (
          <EmptyState
            icon="users"
            title={
              search.q || search.status
                ? "No matching providers"
                : "No service providers yet"
            }
            description={
              search.q || search.status
                ? "Try different filters."
                : "Add the companies that should receive breakdown alerts."
            }
            action={
              writable && !search.q ? (
                <CreateAction asChild>
                  <Link to="/admin/providers/new">
                    <Plus /> Add provider
                  </Link>
                </CreateAction>
              ) : undefined
            }
          />
        ) : data ? (
          <ul className="divide-y">
            {data.items.map((provider) => (
              <li key={provider.id}>
                <Link
                  to="/admin/providers/$providerId"
                  params={{ providerId: provider.id }}
                  className="grid gap-3 p-4 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold [overflow-wrap:anywhere]">
                      {provider.companyName}
                    </p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {provider.contactName} · {provider.whatsappNumber}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {provider.services.slice(0, 3).map((service) => (
                      <Badge key={service} variant="secondary">
                        {serviceTypeLabels[service]}
                      </Badge>
                    ))}
                    {provider.services.length > 3 && (
                      <Badge variant="outline">+{provider.services.length - 3}</Badge>
                    )}
                    {!provider.services.length && (
                      <span className="text-xs text-muted-foreground">
                        No services recorded
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      {provider.jobsHandled ?? 0} job
                      {provider.jobsHandled === 1 ? "" : "s"} handled
                    </p>
                    <p>
                      {provider.lastJobAt
                        ? `Last ${displayDate(provider.lastJobAt)}`
                        : "No jobs yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        provider.status !== "active"
                          ? "outline"
                          : provider.receivesAlerts
                            ? "default"
                            : "destructive"
                      }
                    >
                      {provider.status !== "active"
                        ? "Paused"
                        : provider.receivesAlerts
                          ? data.alertsReady ? "Receives alerts" : "Alerts on"
                          : provider.optedOutAt
                            ? "Opted out"
                            : "Alerts off"}
                    </Badge>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 text-muted-foreground"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {data && data.total > data.pageSize && (
          <nav
            aria-label="Service provider pages"
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
