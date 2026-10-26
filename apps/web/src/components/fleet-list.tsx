import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageError } from "@/components/page-error";
import { CreateAction, PageHeader } from "@/components/page-header";
import { Plus } from "lucide-react";
import { can, type AdminSession } from "@/lib/auth";
import {
  expired,
  type Driver,
  type Truck,
  type FleetList as List,
  type FleetKind,
  type Search,
} from "@/lib/fleet";

export function FleetList({
  kind,
  result,
  session,
  search,
}: {
  kind: FleetKind;
  result: { data: List<Driver> | List<Truck> | null; error: string | null };
  session: AdminSession;
  search: Search;
}) {
  const [q, setQ] = useState(search.q);
  const navigate = useNavigate();
  if (!result.data) return <PageError message={result.error!} />;
  const { items, total, page, pageSize } = result.data;
  const isDriver = kind === "drivers";
  const title = isDriver ? "Drivers" : "Vehicles";
  const change = (s: Search) =>
    void navigate({
      to: isDriver ? "/admin/drivers" : "/admin/trucks",
      search: s,
    });
  function submit(e: FormEvent) {
    e.preventDefault();
    change({ ...search, q, page: 1 });
  }
  return (
    <>
      <PageHeader
        title={title}
        group={isDriver ? "People & access" : "Vehicles"}
        description={
          isDriver
            ? "Manage driver profiles and truck assignments"
            : "Manage fleet vehicles"
        }
        actions={
          can(session, `${kind}.write`) && (
            <CreateAction asChild>
              <Link to={isDriver ? "/admin/drivers/new" : "/admin/trucks/new"}>
                <Plus /> Add {isDriver ? "driver" : "vehicle"}
              </Link>
            </CreateAction>
          )
        }
      />
      <Card className="gap-5 rounded-xl p-4 shadow-none sm:p-6">
        <form onSubmit={submit} role="search" className="flex flex-wrap gap-3">
          <Input
            aria-label={`Search ${kind}`}
            placeholder={
              isDriver
                ? "Search name, identifier or email"
                : "Search truck, registration or VIN"
            }
            value={q}
            maxLength={200}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:max-w-sm"
          />
          <select
            aria-label="Filter status"
            value={search.status}
            onChange={(e) =>
              change({ ...search, q, page: 1, status: e.target.value })
            }
            className="h-12 rounded-md border bg-white px-3 text-xs"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            {!isDriver && <option value="maintenance">Maintenance</option>}
            <option value="inactive">Inactive</option>
          </select>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="overflow-hidden rounded-xl border">
          <div className="flex items-center justify-between gap-4 p-4">
            <h2 className="text-sm font-semibold">
              {isDriver ? "Drivers" : "Fleet vehicles"}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {total} {total === 1 ? "record" : "records"}
            </p>
          </div>
          <div className="divide-y sm:hidden">
            {items.map((item) => (
              <MobileRecord key={item.id} kind={kind} item={item} />
            ))}
            {!items.length && (
              <p className="p-8 text-center text-xs text-muted-foreground">
                {search.q || search.status
                  ? "No matching records"
                  : isDriver
                    ? "No drivers yet"
                    : "No trucks yet"}
              </p>
            )}
          </div>
          <Table className="hidden sm:table">
            <TableHeader className="bg-muted">
              <TableRow>
                {(isDriver
                  ? ["Driver", "Identifier", "Assigned vehicle", "Status", ""]
                  : [
                      "Vehicle",
                      "Registration",
                      "Driving now",
                      "Availability",
                      "",
                    ]
                ).map((c, i) => (
                  <TableHead key={i} className="px-4 text-[11px] uppercase">
                    {c || <span className="sr-only">Open profile</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  {isDriver ? (
                    <DriverRow driver={item as Driver} />
                  ) : (
                    <TruckRow truck={item as Truck} />
                  )}
                </TableRow>
              ))}
              {!items.length && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-40 text-center text-xs text-muted-foreground"
                  >
                    {search.q || search.status
                      ? "No matching records"
                      : isDriver
                        ? "No drivers yet"
                        : "No trucks yet"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => change({ ...search, page: page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={page * pageSize >= total}
              onClick={() => change({ ...search, page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
function DriverRow({ driver: d }: { driver: Driver }) {
  return (
    <>
      <TableCell className="p-4">
        <Link
          to="/admin/drivers/$driverId"
          params={{ driverId: d.id }}
          className="font-semibold hover:underline"
        >
          {d.user.firstName} {d.user.lastName}
        </Link>
        <p className="mt-1 text-[11px] text-muted-foreground">{d.user.email}</p>
      </TableCell>
      <TableCell className="px-4">{d.identifier}</TableCell>
      <TableCell className="px-4">
        {d.currentTruck
          ? `${d.currentTruck.identifier} · ${d.currentTruck.registration}`
          : "Unassigned"}
      </TableCell>
      <TableCell className="px-4">
        <div className="flex flex-col items-start gap-1">
          <Badge variant="outline">
            {d.status === "active" ? "Active" : "Inactive"}
          </Badge>
          {!d.user.isActive && (
            <span className="text-[11px] text-destructive">
              Account inactive
            </span>
          )}
          {(expired(d.licenceExpiresOn) || expired(d.prdpExpiresOn)) && (
            <span className="text-[11px] text-destructive">
              Licence / PrDP expired
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="px-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/drivers/$driverId" params={{ driverId: d.id }}>
            Open<span className="sr-only"> {d.identifier}</span>
          </Link>
        </Button>
      </TableCell>
    </>
  );
}
function TruckRow({ truck: t }: { truck: Truck }) {
  return (
    <>
      <TableCell className="p-4">
        <Link
          to="/admin/trucks/$truckId"
          params={{ truckId: t.id }}
          className="font-semibold hover:underline"
        >
          {t.identifier}
        </Link>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t.make} {t.model}
        </p>
      </TableCell>
      <TableCell className="px-4">{t.registration}</TableCell>
      <TableCell className="px-4">
        {t.currentDriving?.driverName ?? "No active driver"}
      </TableCell>
      <TableCell className="px-4">
        <Badge variant="outline">
          {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
        </Badge>
        {[
          t.licenceDiscExpiresOn,
          t.roadworthyExpiresOn,
          t.insuranceExpiresOn,
        ].some(expired) && (
          <p className="mt-1 text-[11px] text-destructive">
            Compliance expired
          </p>
        )}
      </TableCell>
      <TableCell className="px-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/trucks/$truckId" params={{ truckId: t.id }}>
            Open<span className="sr-only"> {t.identifier}</span>
          </Link>
        </Button>
      </TableCell>
    </>
  );
}

function MobileRecord({
  kind,
  item,
}: {
  kind: FleetKind;
  item: Driver | Truck;
}) {
  const style =
    "block space-y-3 p-4 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";
  const badge = (
    <Badge variant="outline">
      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
    </Badge>
  );
  if (kind === "drivers") {
    const d = item as Driver;
    return (
      <Link
        to="/admin/drivers/$driverId"
        params={{ driverId: d.id }}
        className={style}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-semibold">
            {d.user.firstName} {d.user.lastName}
          </p>
          {badge}
        </div>
        <p className="text-muted-foreground">{d.identifier}</p>
        <p className="break-all text-muted-foreground">{d.user.email}</p>
        <p>
          {d.currentTruck
            ? `${d.currentTruck.identifier} · ${d.currentTruck.registration}`
            : "Unassigned"}
        </p>
        {!d.user.isActive && (
          <p className="text-destructive">Account inactive</p>
        )}
        {(expired(d.licenceExpiresOn) || expired(d.prdpExpiresOn)) && (
          <p className="text-destructive">Licence / PrDP expired</p>
        )}
      </Link>
    );
  }
  const t = item as Truck;
  return (
    <Link
      to="/admin/trucks/$truckId"
      params={{ truckId: t.id }}
      className={style}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold">{t.identifier}</p>
        {badge}
      </div>
      <p className="text-muted-foreground">
        {t.make} {t.model}
      </p>
      <p>{t.registration}</p>
      <p className="break-all text-muted-foreground">
        Driving now: {t.currentDriving?.driverName ?? "No active driver"}
      </p>
      {[
        t.licenceDiscExpiresOn,
        t.roadworthyExpiresOn,
        t.insuranceExpiresOn,
      ].some(expired) && <p className="text-destructive">Compliance expired</p>}
    </Link>
  );
}
