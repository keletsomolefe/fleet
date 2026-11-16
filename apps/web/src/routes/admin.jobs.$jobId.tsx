import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Copy, MapPin, RotateCw, UserRound } from "lucide-react";
import { PageError } from "@/components/page-error";
import { PageHeader, BackLink } from "@/components/page-header";
import { RefreshButton } from "@/components/refresh-button";
import {
  JobStatusBadge,
  JobTimeline,
  channelLabel,
  OfferStatusBadge,
  ServiceTypeBadge,
} from "@/components/service-job-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { adminOperationsKey } from "@/lib/admin-queries";
import { can } from "@/lib/auth";
import { displayDate } from "@/lib/fleet";
import { submitForm, textFieldProps } from "@/lib/form";
import {
  getJob,
  getProviders,
  jobAction,
  money,
  offerAction,
  providerSearchDefaults,
  serviceTypeDescriptions,
  type JobOffer,
  type ServiceType,
} from "@/lib/service-jobs";

export const Route = createFileRoute("/admin/jobs/$jobId")({ component: Page });

function Page() {
  const { session } = Route.useRouteContext();
  const { jobId } = Route.useParams();
  const writable = can(session, "service_jobs.write");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [panel, setPanel] = useState<
    "assign" | "close" | "cancel" | "reopen" | "note" | null
  >(null);
  const { data, error: loadError, isPending, isFetching, refetch } = useQuery({
    queryKey: [...adminOperationsKey(session.user.id), "job", jobId],
    queryFn: () => getJob(jobId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setError("");
    setSaved("");
    try {
      const result = await jobAction(session.csrfToken, jobId, action, body);
      setPanel(null);
      if (action === "broadcast") {
        const queued = Number(result.queued ?? 0);
        setSaved(
          queued
            ? `${queued} provider alert${queued === 1 ? "" : "s"} queued.`
            : "No provider alerts were queued.",
        );
      } else if (action === "close") setSaved("Job closed.");
      else if (action === "cancel") setSaved("Job cancelled.");
      else if (action === "reopen") setSaved("Job reopened.");
      else if (action === "assign") setSaved("Provider assigned.");
      else setSaved("Saved.");
      await refetch();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this change.",
      );
      throw cause;
    }
  };
  const job = data?.job;
  const completion = data?.events.filter((event) => event.kind === "completed").at(-1);
  return (
    <>
      <PageHeader
        back={<BackLink to="/admin/jobs">Service jobs</BackLink>}
        title={job ? job.reference : "Service job"}
        group="Operations"
        description={
          job?.truck
            ? `${job.truck.registration} · ${job.truck.identifier}`
            : undefined
        }
        actions={
          <>
            <RefreshButton busy={isFetching} onRefresh={() => void refetch()} />
            {job && writable && (
              <>
                {job.status === "open" && (
                  <Button onClick={() => void run("broadcast").catch(() => {})}>
                    Alert again
                  </Button>
                )}
                {["open", "assigned", "in_progress"].includes(job.status) && (
                  <Button
                    variant="outline"
                    onClick={() => setPanel(panel === "assign" ? null : "assign")}
                  >
                    {job.provider ? "Reassign" : "Assign provider"}
                  </Button>
                )}
                {!["closed", "cancelled"].includes(job.status) && (
                  <Button
                    variant={job.status === "completed" ? "default" : "outline"}
                    onClick={() => setPanel(panel === "close" ? null : "close")}
                  >
                    Close job
                  </Button>
                )}
                {job.status === "closed" && (
                  <Button
                    variant="outline"
                    onClick={() => setPanel(panel === "reopen" ? null : "reopen")}
                  >
                    Reopen
                  </Button>
                )}
                {["open", "assigned", "in_progress"].includes(job.status) && (
                  <Button
                    variant="outline"
                    onClick={() => setPanel(panel === "cancel" ? null : "cancel")}
                  >
                    Cancel
                  </Button>
                )}
              </>
            )}
          </>
        }
      />
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
      {!data && isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading service job…
        </p>
      )}
      {loadError && <PageError message={loadError.message} />}
      {data && job && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {data && !data.alertsReady && (
              <Alert>
                <AlertDescription>
                  Provider alerts are not available yet. Service providers will
                  not be notified.
                </AlertDescription>
              </Alert>
            )}
            {data && data.alertsReady && data.activeProviderCount === 0 && (
              <Alert>
                <AlertDescription>
                  No active service providers are available. Add a provider or
                  send alerts again later.
                </AlertDescription>
              </Alert>
            )}
            {panel && (
              <Card className="gap-4 p-4 shadow-none sm:p-6">
                {panel === "assign" && (
                  <AssignForm
                    onSubmit={async (body) => {
                      await run("assign", body);
                    }}
                  />
                )}
                {panel === "close" && (
                  <CloseForm
                    canResolve={can(session, "issues.resolve")}
                    hasIssue={!!job.issueId}
                    onSubmit={async (body) => {
                      await run("close", body);
                    }}
                  />
                )}
                {panel === "cancel" && (
                  <TextActionForm
                    title="Cancel job"
                    label="Why is this job being cancelled?"
                    submitLabel="Cancel job"
                    onSubmit={async (value) => {
                      await run("cancel", { reason: value.reason });
                    }}
                  />
                )}
                {panel === "reopen" && (
                  <ReopenForm
                    resolvedIssue={job.resolvedIssueOnClose}
                    onSubmit={async (value) => {
                      await run("reopen", value);
                    }}
                  />
                )}
                {panel === "note" && (
                  <TextActionForm
                    title="Internal note"
                    label="Add a note for the office"
                    submitLabel="Add note"
                    onSubmit={async (value) => {
                      await run("notes", { note: value.reason });
                    }}
                  />
                )}
              </Card>
            )}
            <Card className="gap-4 p-4 shadow-none sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ServiceTypeBadge type={job.serviceType} />
                    <JobStatusBadge status={job.status} stage={job.latestStage} />
                    <Badge variant="outline">
                      {job.urgency === "urgent" ? "Urgent" : "Normal"}
                    </Badge>
                  </div>
                  <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">
                    {job.title}
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Reported {displayDate(job.createdAt)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {serviceTypeDescriptions[job.serviceType as ServiceType]}
              </p>
              <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                {job.description}
              </p>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Vehicle</p>
                  <p>
                    {job.truck
                      ? `${job.truck.registration} · ${job.truck.identifier}`
                      : "Not recorded"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {job.truck ? `${job.truck.make} ${job.truck.model}` : ""}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Driver</p>
                  <p>{job.driver?.name ?? "Not recorded"}</p>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Location</p>
                  <p className="flex flex-wrap items-center gap-2">
                    <MapPin aria-hidden="true" className="size-4" />
                    {job.locationText ??
                      (job.latitude != null
                        ? "Location shared on the job page"
                        : "Not shared")}
                    {job.latitude != null && job.longitude != null && (
                      <a
                        href={`https://www.google.com/maps?q=${job.latitude},${job.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline underline-offset-4"
                      >
                        Open in Maps
                      </a>
                    )}
                  </p>
                </div>
              </div>
              {job.issue && (
                <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    Driver report {displayDate(job.issue.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {job.issue.description}
                  </p>
                  {job.issue.resolutionNote && (
                    <p className="text-xs text-muted-foreground">
                      Resolution: {job.issue.resolutionNote}
                    </p>
                  )}
                </div>
              )}
            </Card>
            <Card className="gap-4 p-4 shadow-none sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Timeline</h2>
                {writable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPanel(panel === "note" ? null : "note")}
                  >
                    Add note
                  </Button>
                )}
              </div>
              <JobTimeline events={data.events} />
            </Card>
          </div>
          <aside className="space-y-4">
            <Card className="gap-4 p-4 shadow-none sm:p-5">
              <h2 className="text-sm font-semibold">Assigned provider</h2>
              {job.provider ? (
                <div className="space-y-1 text-sm">
                  <p className="flex items-center gap-2 font-semibold [overflow-wrap:anywhere]">
                    <UserRound aria-hidden="true" className="size-4" />
                    {job.provider.companyName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {job.acceptedAt
                      ? `Accepted ${displayDate(job.acceptedAt)}`
                      : "Assigned"}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Waiting for a provider to accept.
                </p>
              )}
            </Card>
            <Card className="gap-4 p-4 shadow-none sm:p-5">
              <h2 className="text-sm font-semibold">
                Provider alerts ({data.offers.length})
              </h2>
              {!data.offers.length ? (
                <p className="text-sm text-muted-foreground">
                  No provider alerts were sent.
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.offers.map((offer) => (
                    <OfferRow
                      key={offer.id}
                      jobId={job.id}
                      offer={offer}
                      csrfToken={session.csrfToken}
                      writable={writable}
                      onChanged={async () => {
                        setSaved("Provider alert updated.");
                        await refetch();
                      }}
                      onError={setError}
                    />
                  ))}
                </ul>
              )}
            </Card>
            {(job.status === "completed" ||
              job.status === "closed" ||
              job.completionNote) && (
              <Card className="gap-3 p-4 shadow-none sm:p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                  Completion
                </h2>
                {completion && (
                  <p className="text-xs text-muted-foreground">
                    {[completion.actorName, completion.channel && channelLabel(completion.channel), displayDate(completion.createdAt)]
                      .filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {job.completionNote ?? "No completion note recorded."}
                </p>
                {money(job.completionCostCents, job.currency) && (
                  <p className="text-sm">
                    Charged {money(job.completionCostCents, job.currency)}
                  </p>
                )}
                {!!data.attachments.length && (
                  <div className="flex flex-wrap gap-2">
                    {data.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={`/api/admin/service-jobs/${job.id}/photos/${attachment.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={`/api/admin/service-jobs/${job.id}/photos/${attachment.id}`}
                          alt="Completion"
                          loading="lazy"
                          className="size-24 rounded-md border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </Card>
            )}
            {job.closeNote && (
              <Card className="gap-3 p-4 shadow-none sm:p-5">
                <h2 className="text-sm font-semibold">Close note</h2>
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {job.closeNote}
                </p>
                <p className="text-xs text-muted-foreground">
                  {job.closedBy ? `Closed by ${job.closedBy}` : ""}
                </p>
              </Card>
            )}
            {job.cancelReason && (
              <Card className="gap-3 p-4 shadow-none sm:p-5">
                <h2 className="text-sm font-semibold">Cancellation</h2>
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {job.cancelReason}
                </p>
              </Card>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function OfferRow({
  jobId,
  offer,
  csrfToken,
  writable,
  onChanged,
  onError,
}: {
  jobId: string;
  offer: JobOffer;
  csrfToken: string;
  writable: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const act = async (
    action: "resend" | "revoke" | "link",
    method: "POST" | "GET" = "POST",
  ) => {
    if (
      action === "revoke" &&
      !window.confirm("Revoke this provider link? The provider will need a new link.")
    )
      return;
    setBusy(true);
    setNotice("");
    onError("");
    try {
      const result = await offerAction(
        csrfToken,
        jobId,
        offer.id,
        action,
        method,
      );
      if (action === "link" && result.link) {
        await navigator.clipboard.writeText(result.link);
        setNotice("Link copied.");
      } else if (action === "resend") {
        setNotice("Alert queued again.");
      } else if (action === "revoke") {
        setNotice("Link revoked.");
      }
      await onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update alert.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 border-b pb-3 text-sm last:border-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold [overflow-wrap:anywhere]">
            {offer.provider.companyName}
          </p>
          <p className="text-xs text-muted-foreground">
            {offer.provider.whatsappNumber}
          </p>
        </div>
        <OfferStatusBadge offer={offer} />
      </div>
      {(offer.readAt || offer.deliveredAt || offer.sentAt) && (
        <p className="text-xs text-muted-foreground">
          {offer.readAt
            ? `Read · ${displayDate(offer.readAt)}`
            : offer.deliveredAt
              ? `Delivered · ${displayDate(offer.deliveredAt)}`
              : `Sent · ${displayDate(offer.sentAt!)}`}
        </p>
      )}
      {offer.responderName && (
        <p className="text-xs text-muted-foreground">
          {offer.responderName} ·{" "}
          {offer.responseChannel === "whatsapp"
            ? "WhatsApp"
            : offer.responseChannel === "admin"
              ? "Office assignment"
              : "Web link"}
          {offer.respondedAt ? ` · ${displayDate(offer.respondedAt)}` : ""}
        </p>
      )}
      {offer.lastErrorTitle && (
        <p className="text-xs text-destructive">{offer.lastErrorTitle}</p>
      )}
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {writable && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void act("link", "GET").catch(() => {})}
          >
            <Copy aria-hidden="true" /> Copy link
          </Button>
          {offer.status !== "accepted" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void act("resend").catch(() => {})}
            >
              <RotateCw aria-hidden="true" /> Resend
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void act("revoke").catch(() => {})}
          >
            Revoke link
          </Button>
        </div>
      )}
    </li>
  );
}

function AssignForm({
  onSubmit,
}: {
  onSubmit: (body: { providerId: string; reason: string }) => Promise<void>;
}) {
  const providers = useQuery({
    queryKey: ["job-assign-providers"],
    queryFn: () =>
      getProviders({ ...providerSearchDefaults, status: "active" }),
  });
  const form = useForm({
    defaultValues: { providerId: "", reason: "" },
    validators: {
      onSubmit: ({ value }) =>
        !value.providerId
          ? "Choose a provider."
          : !value.reason.trim()
            ? "Enter a reason."
            : undefined,
    },
    onSubmit: async ({ value }) => {
      await onSubmit({ providerId: value.providerId, reason: value.reason.trim() });
      form.reset();
    },
  });
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  return (
    <form onSubmit={submitForm(form)} className="space-y-4">
      <h2 className="text-sm font-semibold">Assign provider</h2>
      {(validationError || providers.error) && (
        <Alert variant="destructive">
          <AlertDescription>
            {validationError || providers.error?.message}
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="providerId">Service provider</Label>
        <form.Field name="providerId">
          {(field) => (
            <select
              id="providerId"
              required
              value={field.state.value}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              className="h-12 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              <option value="" disabled>
                Choose a provider
              </option>
              {providers.data?.items.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.companyName} · {provider.whatsappNumber}
                </option>
              ))}
            </select>
          )}
        </form.Field>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reason">Why are you assigning this provider?</Label>
        <form.Field name="reason">
          {(field) => (
            <textarea
              {...textFieldProps(field)}
              id="reason"
              required
              maxLength={1000}
              className="min-h-20 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
          )}
        </form.Field>
      </div>
      <Button disabled={busy}>{busy ? "Assigning…" : "Assign provider"}</Button>
    </form>
  );
}

function CloseForm({
  canResolve,
  hasIssue,
  onSubmit,
}: {
  canResolve: boolean;
  hasIssue: boolean;
  onSubmit: (body: { note: string; resolveIssue: boolean }) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { note: "" },
    validators: {
      onSubmit: ({ value }) =>
        value.note.trim() ? undefined : "Enter a close note.",
    },
    onSubmit: async ({ value }) => {
      await onSubmit({
        note: value.note.trim(),
        resolveIssue: resolveIssue,
      });
      form.reset();
    },
  });
  const [resolveIssue, setResolveIssue] = useState(hasIssue && canResolve);
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  return (
    <form onSubmit={submitForm(form)} className="space-y-4">
      <h2 className="text-sm font-semibold">Close job</h2>
      {validationError && (
        <Alert variant="destructive">
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="closeNote">What was checked or completed?</Label>
        <form.Field name="note">
          {(field) => (
            <textarea
              {...textFieldProps(field)}
              id="closeNote"
              required
              maxLength={1000}
              className="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
          )}
        </form.Field>
      </div>
      {hasIssue && canResolve && (
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={resolveIssue}
            onChange={(event) => setResolveIssue(event.currentTarget.checked)}
          />
          <span>Resolve the driver’s report at the same time.</span>
        </label>
      )}
      <Button disabled={busy}>{busy ? "Closing…" : "Close job"}</Button>
    </form>
  );
}

function ReopenForm({
  resolvedIssue,
  onSubmit,
}: {
  resolvedIssue: boolean;
  onSubmit: (body: { reason: string; reopenIssue: boolean }) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { reason: "" },
    validators: {
      onSubmit: ({ value }) =>
        value.reason.trim() ? undefined : "Enter a reason.",
    },
    onSubmit: async ({ value }) => {
      await onSubmit({
        reason: value.reason.trim(),
        reopenIssue,
      });
      form.reset();
    },
  });
  const [reopenIssue, setReopenIssue] = useState(resolvedIssue);
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  return (
    <form onSubmit={submitForm(form)} className="space-y-4">
      <h2 className="text-sm font-semibold">Reopen job</h2>
      {validationError && (
        <Alert variant="destructive">
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="reopenReason">Why is this job being reopened?</Label>
        <form.Field name="reason">
          {(field) => (
            <textarea
              {...textFieldProps(field)}
              id="reopenReason"
              required
              maxLength={1000}
              className="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
          )}
        </form.Field>
      </div>
      {resolvedIssue && (
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={reopenIssue}
            onChange={(event) => setReopenIssue(event.currentTarget.checked)}
          />
          <span>Reopen the driver’s report as well.</span>
        </label>
      )}
      <Button disabled={busy}>{busy ? "Reopening…" : "Reopen job"}</Button>
    </form>
  );
}

function TextActionForm({
  title,
  label,
  submitLabel,
  onSubmit,
}: {
  title: string;
  label: string;
  submitLabel: string;
  onSubmit: (value: { reason: string }) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { reason: "" },
    validators: {
      onSubmit: ({ value }) =>
        value.reason.trim() ? undefined : "Enter a reason.",
    },
    onSubmit: async ({ value }) => {
      await onSubmit({ reason: value.reason.trim() });
      form.reset();
    },
  });
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  return (
    <form onSubmit={submitForm(form)} className="space-y-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {validationError && (
        <Alert variant="destructive">
          <AlertDescription>{validationError}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="reason">{label}</Label>
        <form.Field name="reason">
          {(field) => (
            <textarea
              {...textFieldProps(field)}
              id="reason"
              required
              maxLength={1000}
              className="min-h-20 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
          )}
        </form.Field>
      </div>
      <Button disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
