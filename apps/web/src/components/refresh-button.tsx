import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RefreshButton({
  busy,
  onRefresh,
}: {
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-disabled={busy}
      onClick={() => {
        if (!busy) onRefresh();
      }}
    >
      <RotateCw
        aria-hidden="true"
        className={busy ? "motion-safe:animate-spin" : undefined}
      />
      {busy ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
