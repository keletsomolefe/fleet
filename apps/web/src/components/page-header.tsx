import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CreateAction({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return <Button {...props} className={cn("w-auto", className)} />;
}

export function BackLink({
  to,
  children,
}: {
  to:
    | "/admin/users"
    | "/admin/drivers"
    | "/admin/trucks"
    | "/admin/jobs"
    | "/admin/providers"
    | "/admin/activities";
  children: ReactNode;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="-ml-2.5 w-fit font-semibold"
    >
      {to === "/admin/activities" ? (
        <Link to="/admin/activities">
          <ArrowLeft aria-hidden="true" />
          {children}
        </Link>
      ) : (
        <Link
          to={to}
          search={
            to === "/admin/users"
              ? { q: "", page: 1 }
              : to === "/admin/jobs"
                ? { q: "", page: 1, status: "active", providerId: "" }
                : to === "/admin/providers"
                  ? { q: "", page: 1, status: "" }
                  : { q: "", page: 1, status: "" }
          }
        >
          <ArrowLeft aria-hidden="true" />
          {children}
        </Link>
      )}
    </Button>
  );
}

export function PageHeader({
  title,
  group,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  group?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      {back}
      <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-start @3xl:justify-between @3xl:gap-6">
        <div className="min-w-0 max-w-2xl space-y-1">
          {group && (
            <p className="text-[11px] leading-4 text-muted-foreground uppercase">
              {group}
            </p>
          )}
          <h1 className="[overflow-wrap:anywhere]">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 @3xl:shrink-0 @3xl:pt-1">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
