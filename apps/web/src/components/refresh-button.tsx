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
      type="button"
      variant="outline"
      aria-busy={busy}
      aria-disabled={busy}
      aria-label={busy ? "Refreshing" : "Refresh"}
      onClick={() => {
        if (!busy) onRefresh();
      }}
    >
      <RotateCw
        aria-hidden="true"
        className={busy ? "motion-safe:animate-spin" : undefined}
      />
      <span>Refresh</span>
    </Button>
  );
}
