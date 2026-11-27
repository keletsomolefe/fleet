import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function FilterBar({
  activeCount = 0,
  onClear,
  summary,
  children,
  className,
}: {
  activeCount?: number;
  onClear?: () => void;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className={cn("gap-0 py-0 shadow-none", className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 @2xl:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className="h-9 gap-1.5 text-xs"
          >
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            <span>Filters</span>
            {activeCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-0.5 h-5 min-w-5 justify-center px-1.5 text-[10px]"
              >
                {activeCount}
              </Badge>
            )}
            {open ? (
              <ChevronUp aria-hidden="true" className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
            )}
          </Button>
          {activeCount > 0 && onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-9 gap-1 px-2 text-xs text-muted-foreground"
            >
              <X aria-hidden="true" className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
        {summary && <div className="min-w-0 shrink-0 text-right">{summary}</div>}
      </div>

      <CardContent
        className={cn(
          "border-t p-3.5 @2xl:block @2xl:border-t-0 @2xl:p-4",
          open ? "block" : "hidden",
        )}
      >
        {children}
      </CardContent>
    </Card>
  );
}
