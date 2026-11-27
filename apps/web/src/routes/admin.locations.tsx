import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader, CreateAction } from "@/components/page-header";
import { PageError } from "@/components/page-error";
import { ListRowsSkeleton } from "@/components/page-skeletons";
import { EmptyState } from "@/components/empty-state";
import { RefreshButton } from "@/components/refresh-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import {
  getTransportCatalogue,
  saveMaster,
  siteTypeLabels,
  type LocationDto,
  type SiteType,
} from "@/lib/transport";

export const Route = createFileRoute("/admin/locations")({
  loader: async ({ context }) => {
    if (!can(context.session, "locations.read")) return;
    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: [
          ...adminOperationsKey(context.session.user.id),
          "transport-catalogue",
        ],
        queryFn: getTransportCatalogue,
      }),
    ]);
  },
  component: LocationsPage,
});

function LocationsPage() {
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const readable = can(session, "locations.read");
  const writable = can(session, "locations.write");

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "transport-catalogue"],
    queryFn: getTransportCatalogue,
    enabled: readable,
  });

  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<LocationDto | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [siteType, setSiteType] = useState<SiteType>("both");
  const [directions, setDirections] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  if (!readable) {
    return <PageError message="You do not have access to Locations." />;
  }

  function openNew() {
    setEditing(null);
    setName("");
    setSiteType("both");
    setDirections("");
    setContact("");
    setPhone("");
    setCustomerIds([]);
    setLatitude("");
    setLongitude("");
    setActive(true);
    setFormError("");
    setShowForm(true);
  }

  function openEdit(loc: LocationDto) {
    setEditing(loc);
    setName(loc.name);
    setSiteType(loc.siteType);
    setDirections(loc.directions);
    setContact(loc.contact);
    setPhone(loc.phone);
    setCustomerIds(loc.customerIds);
    setLatitude(loc.latitude != null ? String(loc.latitude) : "");
    setLongitude(loc.longitude != null ? String(loc.longitude) : "");
    setActive(loc.active);
    setFormError("");
    setShowForm(true);
  }

  function toggleCustomer(id: string) {
    setCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setStatusMessage("");
    try {
      await saveMaster(
        session.csrfToken,
        "locations",
        {
          name,
          siteType,
          directions,
          contact,
          phone,
          customerIds,
          latitude: latitude.trim() ? Number(latitude) : null,
          longitude: longitude.trim() ? Number(longitude) : null,
          active,
          ...(editing ? { version: editing.version } : {}),
        },
        editing?.id,
      );
      setShowForm(false);
      setEditing(null);
      setStatusMessage(editing ? "Location updated." : "Location added.");
      await refreshAdminOperations(queryClient, session.user.id);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save location.",
      );
    } finally {
      setBusy(false);
    }
  }

  const customersById = new Map(
    (data?.customers ?? []).map((c) => [c.id, c.name]),
  );
  const filtered = (data?.locations ?? []).filter((loc) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return (
      loc.name.toLowerCase().includes(term) ||
      loc.directions.toLowerCase().includes(term) ||
      siteTypeLabels[loc.siteType].toLowerCase().includes(term)
    );
  });

  return (
    <>
      <PageHeader
        title="Locations"
        group="Customers & rates"
        description="Saved pickup mines, quarries, depots, delivery sites and fuel stops."
        actions={
          <>
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
            {writable && (
              <CreateAction onClick={openNew}>
                <Plus /> Add location
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
      {error && <PageError message={error.message} />}
      {formError && <PageError message={formError} />}

      {showForm && writable && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">
              {editing ? `Edit ${editing.name}` : "Add location"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSave(e)} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="loc-name">Site name</Label>
                <Input
                  id="loc-name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Middelburg North Pit"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-type">Site type</Label>
                <select
                  id="loc-type"
                  className="h-12 w-full rounded-xl border border-input bg-background pl-3.5 pr-10 text-sm"
                  value={siteType}
                  onChange={(e) => setSiteType(e.target.value as SiteType)}
                >
                  {(Object.keys(siteTypeLabels) as SiteType[]).map((key) => (
                    <option key={key} value={key}>
                      {siteTypeLabels[key]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="loc-dir">Directions / gate access</Label>
                <Input
                  id="loc-dir"
                  maxLength={2000}
                  value={directions}
                  onChange={(e) => setDirections(e.target.value)}
                  placeholder="Road number, weighbridge gate, or entry instructions"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-contact">Site contact</Label>
                <Input
                  id="loc-contact"
                  maxLength={200}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-phone">Site phone</Label>
                <Input
                  id="loc-phone"
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-lat">Latitude (optional)</Label>
                <Input
                  id="loc-lat"
                  inputMode="decimal"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="-25.7751"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc-lon">Longitude (optional)</Label>
                <Input
                  id="loc-lon"
                  inputMode="decimal"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="29.4648"
                />
              </div>
              {(data?.customers.length ?? 0) > 0 && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Linked customers (leave blank for shared site)</Label>
                  <div className="flex flex-wrap gap-3">
                    {data?.customers
                      .filter((c) => c.active)
                      .map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={customerIds.includes(c.id)}
                            onCheckedChange={() => toggleCustomer(c.id)}
                          />
                          {c.name}
                        </label>
                      ))}
                  </div>
                </div>
              )}
              {editing && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Checkbox
                    checked={active}
                    onCheckedChange={(v) => setActive(Boolean(v))}
                  />
                  Active location
                </label>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save location"}
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

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="border-b p-4 sm:p-5">
          <Input
            aria-label="Search locations"
            placeholder="Search by site name, type or directions"
            className="max-w-md"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {isPending ? (
          <ListRowsSkeleton rows={4} />
        ) : !filtered.length ? (
          <EmptyState
            icon="map"
            title={q ? "No matching locations" : "No locations yet"}
            description="Save pickup and drop-off sites so drivers can pick them cleanly on the road."
          />
        ) : (
          <ul className="divide-y">
            {filtered.map((loc) => (
              <li
                key={loc.id}
                className="flex flex-col gap-3 p-4 @2xl:flex-row @2xl:items-start @2xl:justify-between sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{loc.name}</p>
                    <Badge variant="secondary">
                      {siteTypeLabels[loc.siteType]}
                    </Badge>
                    {!loc.active && <Badge variant="outline">Archived</Badge>}
                  </div>
                  {loc.directions && (
                    <p className="text-xs text-muted-foreground">
                      {loc.directions}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {loc.customerIds.length
                      ? loc.customerIds
                          .map((cid) => customersById.get(cid) ?? cid)
                          .join(", ")
                      : "Shared site"}
                    {loc.contact ? ` · ${loc.contact}` : ""}
                    {loc.phone ? ` · ${loc.phone}` : ""}
                  </p>
                </div>
                {writable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(loc)}
                  >
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
