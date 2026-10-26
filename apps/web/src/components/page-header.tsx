import type { ReactNode } from "react";

export function PageHeader({
  title,
  group = "Operations",
  description,
  actions,
}: {
  title: ReactNode;
  group?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-4">
      <div className="min-h-[68px] space-y-1">
        <div className="text-[11px] leading-4 text-muted-foreground uppercase">
          {group}
        </div>
        <h1>{title}</h1>
        {description && (
          <p className="text-xs leading-4 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {actions}
        </div>
      )}
    </div>
  );
}
