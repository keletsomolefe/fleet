import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminOperationsKey } from "@/lib/admin-queries";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  const { data: items = [], error, isPending, refetch } = useQuery({
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
          <Button variant="outline" onClick={() => void refetch()}>
            Refresh
          </Button>
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
          <Card className="p-6 shadow-none">
            <p className="text-sm text-muted-foreground">
              No completed repairs yet.
            </p>
          </Card>
        )}
        {items.map((item) => (
          <Card key={item.id} className="gap-4 p-6 shadow-none">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="font-semibold">
                {item.truck?.registration ?? "Truck"} · {item.truck?.identifier}
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
              <h3 className="font-medium">
                Repair response
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
