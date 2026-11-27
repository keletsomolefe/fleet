import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downloadReportFile,
  type ReportDataset,
  type ReportFormat,
} from "@/lib/transport";

export function ExportMenu({
  dataset,
  filters = {},
  label = "Export",
  showBuilderLink = true,
  onError,
}: {
  dataset: ReportDataset;
  filters?: Record<string, string | boolean | undefined>;
  label?: string;
  showBuilderLink?: boolean;
  onError?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<ReportFormat | null>(null);
  const [localError, setLocalError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function runExport(format: ReportFormat) {
    setBusyFormat(format);
    setLocalError("");
    try {
      await downloadReportFile(dataset, format, filters);
      setOpen(false);
    } catch (cause) {
      const msg =
        cause instanceof Error ? cause.message : "Could not download report.";
      if (onError) onError(msg);
      else setLocalError(msg);
    } finally {
      setBusyFormat(null);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busyFormat !== null}
        onClick={() => setOpen((prev) => !prev)}
      >
        {busyFormat ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Download aria-hidden="true" className="size-4" />
        )}
        <span>{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busyFormat !== null}
            onClick={() => void runExport("xlsx")}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
          >
            <FileSpreadsheet
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-foreground"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">
                Excel workbook (.xlsx)
              </span>
              <span className="block text-[11px] leading-4 text-muted-foreground">
                Multi-sheet report with KPIs &amp; totals
              </span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={busyFormat !== null}
            onClick={() => void runExport("csv")}
            className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
          >
            <FileText
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-foreground"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">
                CSV table (.csv)
              </span>
              <span className="block text-[11px] leading-4 text-muted-foreground">
                Clean UTF-8 data for Sheets &amp; BI tools
              </span>
            </span>
          </button>

          {showBuilderLink && (
            <>
              <div className="my-1 border-t" />
              <Link
                to="/admin/reports"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <SlidersHorizontal aria-hidden="true" className="size-3.5" />
                <span>Open Reports &amp; exports</span>
              </Link>
            </>
          )}

          {localError && (
            <p role="alert" className="px-3 py-1.5 text-[11px] text-destructive">
              {localError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
