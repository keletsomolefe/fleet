import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { submitForm, textFieldProps } from "@/lib/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function RepairForm({
  endpoint,
  headers,
  onSaved,
  onCancel,
}: {
  endpoint: string;
  headers: Record<string, string>;
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [error, setError] = useState("");
  const form = useForm({
    defaultValues: { note: "", photos: [] as File[] },
    validators: {
      onSubmit: ({ value: { photos } }) =>
        photos.length > 3 ||
        photos.some((photo) => photo.size > 5 * 1024 * 1024)
          ? "Choose up to 3 photos, each 5 MB or smaller."
          : undefined,
    },
    onSubmit: async ({ value }) => {
      setError("");
      const data = new FormData();
      data.set("note", value.note);
      for (const photo of value.photos) data.append("photos", photo);
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
      }
    },
  });
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  return (
    <form onSubmit={submitForm(form)} className="space-y-5">
      {(validationError || error) && (
        <Alert variant="destructive">
          <AlertDescription>{validationError || error}</AlertDescription>
        </Alert>
      )}
      <fieldset disabled={busy} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="repair-note">What was repaired?</Label>
          <form.Field name="note">
            {(field) => (
              <textarea
                {...textFieldProps(field)}
                id="repair-note"
                required
                maxLength={1000}
                className="min-h-32 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
              />
            )}
          </form.Field>
        </div>
        <div className="space-y-2">
          <Label htmlFor="repair-photos">Repair photos</Label>
          <Input
            id="repair-photos"
            name="photos"
            aria-describedby="repair-photos-hint"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) =>
              form.setFieldValue(
                "photos",
                Array.from(event.currentTarget.files ?? []).filter(
                  (photo) => photo.size > 0,
                ),
              )
            }
            className="h-auto py-2"
          />
          <p id="repair-photos-hint" className="text-xs text-muted-foreground">
            Up to 3 photos · 5 MB each
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="w-full sm:w-auto">
            {busy ? "Saving…" : "Mark issue as resolved"}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
