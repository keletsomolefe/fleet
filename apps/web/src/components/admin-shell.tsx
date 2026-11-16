import { AttentionMenu } from "@/components/attention-menu";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { LogOut, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { can, logout, type AdminSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const navigation = [
  {
    label: "Fleet",
    items: [
      {
        title: "Overview",
        section: "",
        icon: "overview",
        permission: "overview.read",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Service jobs",
        section: "jobs",
        icon: "wrench",
        permission: "service_jobs.read",
      },
      {
        title: "Service providers",
        section: "providers",
        icon: "users",
        permission: "service_providers.read",
      },
    ],
  },
  {
    label: "Company",
    items: [
      {
        title: "Users",
        section: "users",
        icon: "users",
        permission: "users.read",
      },
      {
        title: "Roles & permissions",
        section: "roles",
        icon: "document",
        permission: "users.read",
      },
    ],
  },
  {
    label: "People & assets",
    items: [
      {
        title: "Driver schedule",
        section: "schedules",
        icon: "clock",
        permission: "drivers.write",
      },
      {
        title: "Drivers",
        section: "drivers",
        icon: "users",
        permission: "drivers.read",
      },
      {
        title: "Vehicles",
        section: "trucks",
        icon: "truck",
        permission: "trucks.read",
      },
    ],
  },
  {
    label: "Review & records",
    items: [
      {
        title: "Exceptions",
        section: "vehicle-disputes",
        icon: "alert",
        permission: "issues.read",
      },
    ],
  },
];

function Navigation({ session }: { session: AdminSession }) {
  const path = useLocation({
    select: (location) => location.pathname.replace(/\/$/, ""),
  });
  const { setOpenMobile } = useSidebar();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = `${session.user.firstName} ${session.user.lastName}`;
  const initials = `${session.user.firstName[0] ?? ""}${session.user.lastName[0] ?? ""}`;

  return (
    <Sidebar className="border-r" aria-label="Administration navigation">
      <SidebarHeader className="px-4 pt-4 pb-2">
        <div className="flex h-[88px] items-center gap-3 px-2">
          <img
            src="/design/monogram.svg"
            alt=""
            width={48}
            height={48}
            className="shrink-0"
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold">VHH Fleet</p>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Fleet management
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 md:hidden"
          aria-label="Close navigation"
          onClick={() => setOpenMobile(false)}
        >
          <X />
        </Button>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-4">
        {navigation
          .map((group) => ({
            ...group,
            items: group.items.filter((item) => can(session, item.permission)),
          }))
          .filter((group) => group.items.length)
          .map((group) => (
            <SidebarGroup key={group.label} className="p-0">
              <SidebarGroupLabel className="h-8 px-0 text-[11px] font-medium text-muted-foreground uppercase">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-2">
                  {group.items.map((item) => {
                    const active = item.section
                      ? path === `/admin/${item.section}` ||
                        path.startsWith(`/admin/${item.section}/`)
                      : path === "/admin";
                    const content = (
                      <>
                        <img
                          src={`/design/${item.icon}.svg`}
                          alt=""
                          width={20}
                          height={20}
                          className={cn(
                            "shrink-0 brightness-0",
                            active && "invert",
                          )}
                        />
                        <span>{item.title}</span>
                      </>
                    );
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          className="h-11 gap-3 rounded-xl p-3 text-xs data-[active=true]:bg-black data-[active=true]:font-semibold data-[active=true]:text-white data-[active=true]:hover:bg-black data-[active=true]:hover:text-white"
                        >
                          {item.section === "users" ? (
                            <Link
                              to="/admin/users"
                              search={{ q: "", page: 1 }}
                              aria-current={active ? "page" : undefined}
                              onClick={() => setOpenMobile(false)}
                            >
                              {content}
                            </Link>
                          ) : item.section === "drivers" ||
                            item.section === "trucks" ? (
                            <Link
                              to={
                                item.section === "drivers"
                                  ? "/admin/drivers"
                                  : "/admin/trucks"
                              }
                              search={{ q: "", page: 1, status: "" }}
                              aria-current={active ? "page" : undefined}
                              onClick={() => setOpenMobile(false)}
                            >
                              {content}
                            </Link>
                          ) : item.section === "roles" ? (
                            <Link
                              to="/admin/roles"
                              aria-current={active ? "page" : undefined}
                              onClick={() => setOpenMobile(false)}
                            >
                              {content}
                            </Link>
                          ) : item.section ? (
                            <Link
                              to="/admin/$section"
                              params={{ section: item.section }}
                              aria-current={active ? "page" : undefined}
                              onClick={() => setOpenMobile(false)}
                            >
                              {content}
                            </Link>
                          ) : (
                            <Link
                              to="/admin"
                              aria-current={active ? "page" : undefined}
                              onClick={() => setOpenMobile(false)}
                            >
                              {content}
                            </Link>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>
      <SidebarFooter className="gap-3 p-4">
        <Separator />
        <div className="flex items-center gap-3 px-2 py-1">
          <Avatar className="size-8">
            <AvatarFallback className="bg-muted text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-xs">{name}</p>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {session.roles.map((role) => role.name).join(", ")}
            </p>
          </div>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button
          variant="ghost"
          className="h-10 w-full justify-start gap-3 px-3 text-left text-xs has-[>svg]:px-3"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void logout().catch((cause) => {
              setError(cause.message);
              setBusy(false);
            });
          }}
        >
          <LogOut className="size-5" />
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AdminShell({
  session,
  children,
}: {
  session: AdminSession;
  children: ReactNode;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const item = navigation
    .flatMap((g) => g.items)
    .find(
      (i) =>
        pathname.replace(/\/$/, "") ===
        `/admin${i.section ? `/${i.section}` : ""}`,
    );
  const title =
    pathname.startsWith("/admin/jobs/new") ||
    pathname.startsWith("/admin/providers/new")
      ? pathname.startsWith("/admin/jobs")
        ? "New service job"
        : "Add service provider"
      : pathname.startsWith("/admin/jobs/")
        ? "Service job"
        : pathname.startsWith("/admin/providers/")
          ? "Service provider"
          : pathname.endsWith("/new") || pathname.endsWith("/signup")
            ? pathname.startsWith("/admin/drivers")
              ? "Add a driver"
              : pathname.startsWith("/admin/trucks")
                ? "Add vehicle"
                : "Create user"
            : pathname.startsWith("/admin/users/")
              ? "Users"
              : pathname.startsWith("/admin/drivers/")
                ? "Driver profile"
                : pathname.startsWith("/admin/trucks/")
                  ? "Vehicle profile"
                  : item?.title === "Overview"
                    ? "Fleet overview"
                    : (item?.title ?? "Administration");
  return (
    <SidebarProvider style={{ "--sidebar-width": "240px" } as CSSProperties}>
      <Navigation session={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger
              className="size-10 md:hidden"
              aria-label="Open navigation"
            />
            <p className="truncate text-xs text-muted-foreground">
              <span className="sm:hidden">VHH Fleet</span>
              <span className="hidden sm:inline">{title}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <AttentionMenu session={session} />
            <Avatar className="size-8">
              <AvatarFallback className="bg-muted text-xs">
                {session.user.firstName[0]}
                {session.user.lastName[0]}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-5 bg-muted p-4 sm:gap-6 sm:p-6">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
