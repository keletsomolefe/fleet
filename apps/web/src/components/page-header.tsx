import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CreateAction({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return <Button {...props} className={cn("w-full sm:w-auto", className)} />;
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
    | "/admin/providers";
  children: ReactNode;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="-ml-2.5 w-fit font-semibold"
    >
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
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
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
