import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminOperationsKey } from "@/lib/admin-queries";
import { EmptyState } from "@/components/empty-state";
import { RefreshButton } from "@/components/refresh-button";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { displayDate } from "@/lib/fleet";

type Repair = {
  id: string;
  truck: { registration: string; identifier: string } | null;
  description: string;
  requestedBy: string;
  resolvedBy: string | null;
  verifiedPhone: string | null;
  mechanicName: string | null;
  resolvedAt: string;
  resolutionNote: string;
  photos: string[];
};
export const Route = createFileRoute("/admin/repairs")({
  component: RepairHistory,
});
function RepairHistory() {
  const { session } = Route.useRouteContext();
  const {
    data: items = [],
    error,
    isPending,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "repairs"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/admin/repairs", {
        signal,
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "You do not have access to repairs."
            : "Could not load repairs. Please try again.",
        );
      const data = (await response.json()) as { items: Repair[] };
      return data.items;
    },
  });
  return (
    <>
      <PageHeader
        title="Completed repairs"
        group="Review & records"
        actions={
          <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
        }
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4">
        {isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading repairs…
          </p>
        )}
        {!isPending && !error && !items.length && (
          <Card className="py-0 shadow-none">
            <EmptyState icon="wrench" title="No completed repairs yet" />
          </Card>
        )}
        {items.map((item) => (
          <Card
            key={item.id}
            className="gap-4 p-4 shadow-none sm:p-5 [overflow-wrap:anywhere]"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="font-semibold">
                {item.truck
                  ? `${item.truck.registration} · ${item.truck.identifier}`
                  : "Vehicle not specified"}
              </h2>
              <span className="text-xs text-muted-foreground">
                Resolved {displayDate(item.resolvedAt)}
              </span>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">
                Reported by {item.requestedBy}
              </p>
              <p className="whitespace-pre-wrap break-words">
                {item.description}
              </p>
            </div>
            <div className="space-y-2 rounded-md bg-muted/50 p-4 text-sm">
              <h3 className="font-semibold">
                Repair details
                {item.mechanicName
                  ? ` · ${item.mechanicName}`
                  : item.resolvedBy
                    ? ` · ${item.resolvedBy}`
                    : ""}
              </h3>
              <p className="whitespace-pre-wrap break-words">
                {item.resolutionNote}
              </p>
              {item.verifiedPhone && (
                <p className="text-xs text-muted-foreground">
                  Verified WhatsApp +{item.verifiedPhone}
                </p>
              )}
            </div>
            {!!item.photos.length && (
              <div className="flex flex-wrap gap-3">
                {item.photos.map((photo) => (
                  <a
                    key={photo}
                    href={`/api/admin/issues/${item.id}/repair/photos/${photo}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={`/api/admin/issues/${item.id}/repair/photos/${photo}`}
                      alt="Completed repair"
                      loading="lazy"
                      className="size-28 rounded-md border object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
