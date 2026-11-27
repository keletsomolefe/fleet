import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { submitForm, textFieldProps } from "@/lib/form";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { RecordList } from "@/components/record-list";
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
import { ArrowRight, Plus, Search as SearchIcon } from "lucide-react";
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
  const navigate = useNavigate();
  const isDriver = kind === "drivers";
  const title = isDriver ? "Drivers" : "Vehicles";
  const change = (s: Search) =>
    void navigate({
      to: isDriver ? "/admin/drivers" : "/admin/trucks",
      search: s,
    });
  const form = useForm({
    defaultValues: { q: search.q },
    onSubmit: ({ value }) => change({ ...search, q: value.q, page: 1 }),
  });
  useEffect(() => {
    form.reset({ q: search.q });
  }, [form, search.q]);
  const data = result.data;
  return (
    <>
      <PageHeader
        title={title}
        group="People & assets"
        description={
          isDriver
            ? "Find drivers and their vehicle assignments"
            : "Find vehicles and check their availability"
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
      {!data ? (
        <PageError message={result.error!} />
      ) : (
        <RecordList
          summary={`${data.total} ${isDriver ? (data.total === 1 ? "driver" : "drivers") : data.total === 1 ? "vehicle" : "vehicles"}`}
          page={data.page}
          pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))}
          onPageChange={(page) => change({ ...search, page })}
          filters={
            <form
              onSubmit={submitForm(form)}
              role="search"
              className="flex w-full flex-wrap items-center gap-2 md:w-auto"
            >
              <div className="flex w-full max-w-sm items-center gap-2 sm:w-80">
                <form.Field name="q">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      aria-label={`Search ${isDriver ? "drivers" : "vehicles"}`}
                      placeholder={
                        isDriver
                          ? "Name, driver number or email"
                          : "Registration, fleet number or VIN"
                      }
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
              </div>
              <select
                aria-label="Filter status"
                value={search.status}
                onChange={(e) =>
                  change({
                    ...search,
                    q: form.getFieldValue("q"),
                    page: 1,
                    status: e.target.value,
                  })
                }
                className="h-12 rounded-md border bg-background pl-3.5 pr-10 text-sm"
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                {!isDriver && <option value="maintenance">Maintenance</option>}
                <option value="inactive">Inactive</option>
              </select>
            </form>
          }
        >
          {data.items.length ? (
            <>
              <div className="divide-y lg:hidden">
                {data.items.map((item) => (
                  <MobileRecord key={item.id} kind={kind} item={item} />
                ))}
              </div>
              <Table className="hidden lg:table">
                <TableHeader className="bg-muted">
                  <TableRow>
                    {(isDriver
                      ? [
                          "Driver",
                          "Driver number",
                          "Assigned vehicle",
                          "Status",
                        ]
                      : [
                          "Vehicle",
                          "Fleet number",
                          "Driving now",
                          "Availability",
                        ]
                    ).map((column) => (
                      <TableHead
                        key={column}
                        className="whitespace-normal px-4 text-xs"
                      >
                        {column}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.id}>
                      {isDriver ? (
                        <DriverRow driver={item as Driver} />
                      ) : (
                        <TruckRow truck={item as Truck} />
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <EmptyState
              icon={isDriver ? "users" : "truck"}
              title={
                search.q || search.status
                  ? `No matching ${isDriver ? "drivers" : "vehicles"}`
                  : `No ${isDriver ? "drivers" : "vehicles"} yet`
              }
              action={
                search.q || search.status ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      form.reset({ q: "" });
                      change({ q: "", page: 1, status: "" });
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          )}
        </RecordList>
      )}
    </>
  );
}
function DriverRow({ driver: d }: { driver: Driver }) {
  return (
    <>
      <TableCell className="p-4 whitespace-normal [overflow-wrap:anywhere]">
        <Link
          to="/admin/drivers/$driverId"
          params={{ driverId: d.id }}
          className="font-semibold underline-offset-4 hover:underline focus-visible:underline"
        >
          {d.user.firstName} {d.user.lastName}
          <ArrowRight
            aria-hidden="true"
            className="ml-1.5 inline-block size-3.5 align-text-bottom text-muted-foreground"
          />
        </Link>
        <p className="mt-1 text-[11px] text-muted-foreground">{d.user.email}</p>
      </TableCell>
      <TableCell className="px-4 whitespace-normal [overflow-wrap:anywhere]">
        {d.identifier}
      </TableCell>
      <TableCell className="px-4 whitespace-normal [overflow-wrap:anywhere]">
        {d.currentTruck
          ? `${d.currentTruck.registration} · ${d.currentTruck.identifier}`
          : "Unassigned"}
      </TableCell>
      <TableCell className="px-4 whitespace-normal [overflow-wrap:anywhere]">
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
    </>
  );
}
function TruckRow({ truck: t }: { truck: Truck }) {
  return (
    <>
      <TableCell className="p-4 whitespace-normal [overflow-wrap:anywhere]">
        <Link
          to="/admin/trucks/$truckId"
          params={{ truckId: t.id }}
          className="font-semibold underline-offset-4 hover:underline focus-visible:underline"
        >
          {t.registration}
          <ArrowRight
            aria-hidden="true"
            className="ml-1.5 inline-block size-3.5 align-text-bottom text-muted-foreground"
          />
        </Link>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t.make} {t.model}
        </p>
      </TableCell>
      <TableCell className="px-4 whitespace-normal [overflow-wrap:anywhere]">
        {t.identifier}
      </TableCell>
      <TableCell className="px-4 whitespace-normal [overflow-wrap:anywhere]">
        {t.currentDriving?.driverName ?? "No active driver"}
      </TableCell>
      <TableCell className="px-4 whitespace-normal [overflow-wrap:anywhere]">
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
    "block space-y-2 p-4 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [overflow-wrap:anywhere]";
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
          <p className="min-w-0 flex-1 font-semibold">
            {d.user.firstName} {d.user.lastName}
          </p>
          {badge}
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </div>
        <p className="text-muted-foreground">{d.identifier}</p>
        <p className="text-sm text-muted-foreground">{d.user.email}</p>
        <p>
          {d.currentTruck
            ? `${d.currentTruck.registration} · ${d.currentTruck.identifier}`
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
        <p className="min-w-0 flex-1 font-semibold">{t.registration}</p>
        {badge}
        <ArrowRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </div>
      <p className="text-muted-foreground">
        {t.identifier} · {t.make} {t.model}
      </p>
      <p className="text-sm text-muted-foreground">
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
