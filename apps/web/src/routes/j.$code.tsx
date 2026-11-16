import { useEffect, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MapPin, Phone } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayDate } from "@/lib/fleet";
import { submitForm, textFieldProps } from "@/lib/form";
import {
  completePublicJob,
  getPublicJob,
  getPublicPhoto,
  money,
  publicJobAction,
  serviceTypeLabels,
  type PublicJob,
} from "@/lib/service-jobs";

export const Route = createFileRoute("/j/$code")({
  head: () => ({
    meta: [
      { title: "Service request · VHH Fleet" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: Page,
});

function Page() {
  const { code } = Route.useParams();
  return <ProviderJob key={code} code={code} />;
}

function ProviderJob({ code }: { code: string }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState("");
  const [showComplete, setShowComplete] = useState(
    () =>
      typeof window !== "undefined" && window.location.hash === "#complete",
  );
  const { data, error: loadError, isPending, refetch } = useQuery({
    queryKey: ["public-service-job", code],
    queryFn: () => getPublicJob(code),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  const act = async (
    action: "accept" | "decline" | "progress",
    body: Record<string, unknown>,
    success: string,
  ) => {
    setBusy(action);
    setError("");
    setSaved("");
    try {
      await publicJobAction(code, action, body);
      setSaved(success);
      await refetch();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not complete this action.",
      );
    } finally {
      setBusy("");
    }
  };
  return (
    <main className="min-h-screen bg-muted px-4 py-5 sm:py-10">
      <div className="mx-auto max-w-xl space-y-4">
        <header className="flex items-center gap-3">
          <img src="/design/monogram.svg" alt="" className="size-9" />
          <div>
            <p className="font-semibold">VHH Fleet</p>
            <p className="text-xs text-muted-foreground">Service request</p>
          </div>
        </header>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert role="status">
            <AlertDescription>{saved}</AlertDescription>
          </Alert>
        )}
        {isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading request…
          </p>
        )}
        {loadError && (
          <Card className="gap-3 p-4 shadow-none sm:p-6">
            <h1 className="text-lg font-semibold">This link is not available</h1>
            <p className="text-sm text-muted-foreground">{loadError.message}</p>
          </Card>
        )}
        {data && data.truck && data.title ? (
          <JobContent data={data} />
        ) : data ? (
          <Card className="gap-2 p-4 shadow-none sm:p-6">
            <p className="text-xs text-muted-foreground">
              Job {data.reference}
            </p>
            <h1 className="text-xl font-semibold">Service request</h1>
          </Card>
        ) : null}
        {data && (
          <>
            {data.state === "open" && data.canAccept && (
              <Card className="gap-4 p-4 shadow-none sm:p-6">
                <h2 className="text-base font-semibold">Can you take this job?</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="w-full sm:w-auto"
                    disabled={!!busy}
                    onClick={() =>
                      void act(
                        "accept",
                        { name: "" },
                        "You have accepted this job.",
                      )
                    }
                  >
                    {busy === "accept" ? "Accepting…" : "Accept job"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!!busy}
                    onClick={() =>
                      void act(
                        "decline",
                        { name: "" },
                        "Thanks, we will ask another provider.",
                      )
                    }
                  >
                    {busy === "decline" ? "Sending…" : "Can’t take it"}
                  </Button>
                </div>
              </Card>
            )}
            {data.state === "open" && !data.canAccept && (
              <Alert>
                <AlertDescription>
                  This request is not available to accept. Ask VHH Fleet to send
                  a new link.
                </AlertDescription>
              </Alert>
            )}
            {["assigned", "in_progress"].includes(data.state) &&
              data.canProgress && (
                <>
                  <Card className="gap-4 p-4 shadow-none sm:p-6">
                    <div className="space-y-1">
                      <h2 className="text-base font-semibold">Update progress</h2>
                      {data.latestStage && (
                        <p className="text-sm text-muted-foreground">
                          Current: {stageLabel(data.latestStage)}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        ["en_route", "On my way"],
                        ["arrived", "Arrived"],
                        ["working", "Start work"],
                      ].map(([stage, label]) => (
                        <Button
                          key={stage}
                          variant="outline"
                          disabled={!!busy}
                          onClick={() =>
                            void act(
                              "progress",
                              { stage },
                              "Progress saved.",
                            )
                          }
                        >
                          {busy ? "Saving…" : label}
                        </Button>
                      ))}
                    </div>
                    {!showComplete && (
                      <Button onClick={() => setShowComplete(true)}>
                        Mark completed
                      </Button>
                    )}
                  </Card>
                  {showComplete && (
                    <CompleteForm
                      code={code}
                      onSaved={async () => {
                        setShowComplete(false);
                        setSaved("Job marked completed. VHH Fleet will check it.");
                        await refetch();
                      }}
                    />
                  )}
                </>
              )}
            {data.state === "completed" && (
              <Alert>
                <AlertDescription>
                  This job is completed. VHH Fleet will check and close it.
                </AlertDescription>
              </Alert>
            )}
            {data.state === "closed" && (
              <Alert>
                <AlertDescription>This job has been closed.</AlertDescription>
              </Alert>
            )}
            {data.state === "cancelled" && (
              <Alert>
                <AlertDescription>This request was cancelled.</AlertDescription>
              </Alert>
            )}
            {data.state === "assigned_elsewhere" && (
              <Alert>
                <AlertDescription>
                  This job has been assigned to another provider. Thank you for
                  responding.
                </AlertDescription>
              </Alert>
            )}
            {data.state === "declined" && (
              <Alert>
                <AlertDescription>
                  You declined this request. VHH Fleet will ask another provider.
                </AlertDescription>
              </Alert>
            )}
            {data.state === "expired" && (
              <Alert>
                <AlertDescription>
                  This request is no longer open. Open the latest VHH Fleet alert
                  for current work.
                </AlertDescription>
              </Alert>
            )}
            {data.photos && data.photos.length > 0 && (
              <ProviderPhotos code={code} photos={data.photos} />
            )}
            {data.officePhone && (
              <a
                href={`tel:${data.officePhone}`}
                className="flex min-h-12 items-center justify-center gap-2 rounded-md border bg-background p-3 text-sm"
              >
                <Phone aria-hidden="true" className="size-4" />
                Call VHH Fleet: {data.officePhone}
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function stageLabel(stage: "en_route" | "arrived" | "working") {
  return stage === "en_route"
    ? "On the way"
    : stage === "arrived"
      ? "Arrived"
      : "Working";
}

function JobContent({ data }: { data: PublicJob }) {
  const location = data.locationText;
  return (
    <Card className="gap-4 p-4 shadow-none sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Job {data.reference}</p>
          <h1 className="text-xl font-semibold">
            {data.title ?? serviceTypeLabels[data.serviceType ?? "other"]}
          </h1>
        </div>
        {data.urgency === "urgent" && <Badge>Urgent</Badge>}
      </div>
      {data.truck && (
        <div className="space-y-1">
          <p className="text-lg font-semibold">{data.truck.registration}</p>
          <p className="text-xs text-muted-foreground">
            {data.truck.identifier} · {data.truck.make} {data.truck.model}
          </p>
        </div>
      )}
      {data.description && (
        <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
          {data.description}
        </p>
      )}
      {(location || data.latitude != null) && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <MapPin aria-hidden="true" className="size-4" />
          {location ?? "Location shared on the job page"}
          {data.latitude != null && data.longitude != null && (
            <a
              href={`https://www.google.com/maps?q=${data.latitude},${data.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline underline-offset-4"
            >
              Open in Maps
            </a>
          )}
        </p>
      )}
      {data.createdAt && (
        <p className="text-xs text-muted-foreground">
          Reported {displayDate(data.createdAt)}
        </p>
      )}
      {data.completionNote && (data.state === "completed" || data.state === "closed") && (
        <div className="space-y-1 rounded-md bg-muted p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            Completed
          </p>
          <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            {data.completionNote}
          </p>
          {money(data.completionCostCents, data.currency) && (
            <p className="text-sm">
              {money(data.completionCostCents, data.currency)}
            </p>
          )}
        </div>
      )}
      {data.state === "assigned_elsewhere" && (
        <p className="text-sm text-muted-foreground">
          This job was offered to another provider.
        </p>
      )}
    </Card>
  );
}

function CompleteForm({
  code,
  onSaved,
}: {
  code: string;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const form = useForm({
    defaultValues: { note: "", name: "", amount: "" },
    validators: {
      onSubmit: ({ value }) =>
        value.note.trim() ? undefined : "Describe what was done.",
    },
    onSubmit: async ({ value }) => {
      setError("");
      const data = new FormData();
      data.set("note", value.note.trim());
      if (value.name.trim()) data.set("name", value.name.trim());
      if (value.amount.trim()) {
        const amount = Number(value.amount.replace(",", "."));
        if (!Number.isFinite(amount) || amount < 0)
          return setError("Enter a valid amount.");
        data.set("costCents", String(Math.round(amount * 100)));
      }
      for (const photo of photos) data.append("photos", photo);
      try {
        await completePublicJob(code, data);
        await onSaved();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not complete the job.",
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
    <Card className="gap-4 p-4 shadow-none sm:p-6">
      <h2 className="text-base font-semibold">Mark job completed</h2>
      {(validationError || error) && (
        <Alert variant="destructive">
          <AlertDescription>{validationError || error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submitForm(form)} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="completionNote">What was done?</Label>
            <form.Field name="note">
              {(field) => (
                <textarea
                  {...textFieldProps(field)}
                  id="completionNote"
                  required
                  maxLength={1000}
                  className="min-h-28 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                />
              )}
            </form.Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="completionName">Your name (optional)</Label>
              <form.Field name="name">
                {(field) => (
                  <Input
                    {...textFieldProps(field)}
                    id="completionName"
                    maxLength={80}
                    autoComplete="name"
                  />
                )}
              </form.Field>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount charged (optional)</Label>
              <form.Field name="amount">
                {(field) => (
                  <Input
                    {...textFieldProps(field)}
                    id="amount"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                )}
              </form.Field>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="photos">Photos (optional)</Label>
            <Input
              id="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) =>
                setPhotos(
                  Array.from(event.currentTarget.files ?? []).slice(0, 3),
                )
              }
              className="h-auto py-2"
            />
            <p className="text-xs text-muted-foreground">Up to 3 photos · 5 MB each</p>
          </div>
          <Button disabled={busy}>
            {busy ? "Saving…" : "Mark completed"}
          </Button>
        </fieldset>
      </form>
    </Card>
  );
}

function ProviderPhotos({ code, photos }: { code: string; photos: string[] }) {
  const { data } = useQuery({
    queryKey: ["public-job-photos", code, photos],
    queryFn: () =>
      Promise.all(
        photos.map(async (id) => ({ id, blob: await getPublicPhoto(code, id) })),
      ),
  });
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {data.map(({ id, blob }) => (
        <Photo key={id} blob={blob} />
      ))}
    </div>
  );
}
function Photo({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Completion" className="rounded-md border object-cover" />
    </a>
  );
}
