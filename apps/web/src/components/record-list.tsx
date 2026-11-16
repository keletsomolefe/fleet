import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function RecordList({
  children,
  filters,
  summary,
  page,
  pageCount,
  onPageChange,
}: {
  children: ReactNode;
  filters: ReactNode;
  summary: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const hasPages = page > 1 || pageCount > 1;
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
        {filters}
        <p className="text-xs text-muted-foreground">{summary}</p>
      </div>
      {children}
      {hasPages && (
        <nav
          aria-label="Results pages"
          className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs sm:px-5"
        >
          <span className="text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </Card>
  );
}
