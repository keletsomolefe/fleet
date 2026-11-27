import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KpiCardsSkeleton({
  count = 4,
  className = "grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4",
  showHint = false,
}: {
  count?: number;
  className?: string;
  showHint?: boolean;
}) {
  return (
    <div role="status" aria-label="Loading summary metrics" className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} className="min-w-0 gap-2 p-4 py-4 shadow-none">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-28" />
          {showHint && <Skeleton className="h-3 w-32" />}
        </Card>
      ))}
    </div>
  );
}

export function ListRowsSkeleton({
  rows = 5,
  withBadges = true,
  withAction = true,
}: {
  rows?: number;
  withBadges?: boolean;
  withAction?: boolean;
}) {
  return (
    <ul
      role="status"
      aria-label="Loading records"
      className="divide-y"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <li
          key={index}
          className="flex flex-col gap-3 p-4 @2xl:flex-row @2xl:items-center @2xl:justify-between sm:px-5"
        >
          <div className="min-w-0 flex-1 space-y-2">
            {withBadges && (
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-3.5 w-32" />
              </div>
            )}
            <Skeleton className="h-4 w-3/4 max-w-md" />
            <Skeleton className="h-3.5 w-1/2 max-w-xs" />
          </div>
          {withAction && (
            <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-9 w-24 rounded-lg" />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ReportPreviewSkeleton() {
  return (
    <div role="status" aria-label="Loading report preview" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-56" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-32 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-3.5 w-24" />
      </div>
      <KpiCardsSkeleton
        count={4}
        className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-4"
        showHint
      />
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <CardHeader className="border-b py-3.5">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-5 gap-3 border-b pb-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, rowIdx) => (
            <div key={rowIdx} className="grid grid-cols-5 gap-3 py-1">
              {Array.from({ length: 5 }).map((_, colIdx) => (
                <Skeleton key={colIdx} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function EarningsSkeleton() {
  return (
    <div role="status" aria-label="Loading truck earnings" className="space-y-5">
      <KpiCardsSkeleton
        count={5}
        className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-3 @5xl:grid-cols-5"
        showHint
      />
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <CardHeader className="border-b py-4">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <ListRowsSkeleton rows={3} withBadges={false} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx} className="shadow-none">
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 3 }).map((_, rowIdx) => (
                <div key={rowIdx} className="flex items-center justify-between gap-2">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DetailPageSkeleton({
  columns = 2,
}: {
  columns?: 2 | 3;
}) {
  return (
    <div
      role="status"
      aria-label="Loading details"
      className={cn(
        "grid gap-4",
        columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
      )}
    >
      <Card
        className={cn(
          "shadow-none",
          columns === 3 ? "lg:col-span-2" : undefined,
        )}
      >
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

export function MenuItemsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading notifications" className="divide-y">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="space-y-1.5 py-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}
