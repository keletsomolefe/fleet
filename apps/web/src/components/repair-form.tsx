import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function RepairForm({
  endpoint,
  headers,
  askName = false,
  onSaved,
}: {
  endpoint: string;
  headers: Record<string, string>;
  askName?: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const photos = data
      .getAll("photos")
      .filter((p): p is File => p instanceof File && p.size > 0);
    if (photos.length > 3 || photos.some((p) => p.size > 5 * 1024 * 1024)) {
      setError("Choose up to 3 photos, each 5 MB or smaller.");
      return;
    }
    data.delete("photos");
    for (const photo of photos) data.append("photos", photo);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: data,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          typeof result?.message === "string"
            ? result.message
            : "Could not save the repair. Please try again.",
        );
      }
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the repair.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <fieldset disabled={busy} className="space-y-5">
        {askName && (
          <div className="space-y-2">
            <Label htmlFor="repair-name">Your name</Label>
            <Input
              id="repair-name"
              name="name"
              required
              maxLength={80}
              autoComplete="name"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="repair-note">What was repaired?</Label>
          <textarea
            id="repair-note"
            name="note"
            required
            maxLength={1000}
            className="min-h-32 w-full rounded-md border bg-background p-3 text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repair-photos">Repair photos</Label>
          <Input
            id="repair-photos"
            name="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="h-auto py-2"
          />
          <p className="text-xs text-muted-foreground">
            Up to 3 photos · 5 MB each
          </p>
        </div>
        <Button type="submit" className="w-full sm:w-auto">
          {busy ? "Saving…" : "Mark issue as resolved"}
        </Button>
      </fieldset>
    </form>
  );
}
