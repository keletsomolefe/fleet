import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: ReactNode;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-lg bg-secondary">
        <img
          src={`/design/${icon}.svg`}
          width={20}
          height={20}
          alt=""
          className="size-5 shrink-0 brightness-0"
        />
      </span>
      <div className="space-y-1">
        <div className="font-semibold">{title}</div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
