import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { displayDate } from "@/lib/fleet";
import {
  jobStatusLabel,
  offerStatusLabel,
  serviceTypeLabels,
  type JobCounts,
  type JobEvent,
  type JobOffer,
  type JobStatus,
  type ProgressStage,
  type ServiceType,
} from "@/lib/service-jobs";
import { cn } from "@/lib/utils";

export function JobStatusBadge({
  status,
  stage,
  className,
}: {
  status: JobStatus;
  stage?: ProgressStage | null;
  className?: string;
}) {
  const tone =
    status === "cancelled"
      ? "destructive"
      : status === "closed"
        ? "secondary"
        : status === "open" || status === "completed"
          ? "outline"
          : "default";
  return (
    <Badge variant={tone} className={cn("whitespace-normal", className)}>
      {jobStatusLabel(status, stage)}
    </Badge>
  );
}

export function OfferStatusBadge({ offer }: { offer: JobOffer }) {
  const variant =
    offer.status === "failed"
      ? "destructive"
      : offer.status === "accepted"
        ? "default"
        : "outline";
  return <Badge variant={variant}>{offerStatusLabel(offer.status)}</Badge>;
}

export function ServiceTypeBadge({ type }: { type: ServiceType }) {
  return <Badge variant="secondary">{serviceTypeLabels[type]}</Badge>;
}

export function JobSummaryCards({ counts }: { counts: JobCounts }) {
  const cards = [
    {
      label: "Waiting for provider",
      value: counts.waiting,
      status: "waiting",
    },
    {
      label: "In progress",
      value: counts.working,
      status: "working",
    },
    {
      label: "Awaiting office check",
      value: counts.awaitingClose,
      status: "awaiting",
    },
    {
      label: "Closed today",
      value: counts.closedToday,
      status: "all",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card) => (
        <Link
          key={card.label}
          to="/admin/jobs"
          search={{
            q: "",
            page: 1,
            status: card.status,
            providerId: "",
          }}
          className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Card className="h-full gap-1 p-4 py-4 shadow-none hover:border-ring">
            <p className="text-[11px] leading-4 text-muted-foreground uppercase">
              {card.label}
            </p>
            <p className="text-2xl font-semibold">{card.value}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

const eventLabels: Record<string, string> = {
  created: "Job created",
  alerts_queued: "Provider alerts queued",
  alerts_skipped: "No provider alerts sent",
  alert_requeued: "Provider alert queued again",
  accepted: "Job accepted",
  declined: "Job declined",
  en_route: "On the way",
  arrived: "Arrived on site",
  working: "Work started",
  completed: "Job marked completed",
  closed: "Job closed",
  reopened: "Job reopened",
  cancelled: "Job cancelled",
  reassigned: "Provider reassigned",
  assigned: "Provider assigned",
  admin_note: "Internal note",
  issue_resolved: "Driver report resolved",
  issue_reopened: "Driver report reopened",
  link_revoked: "Provider link revoked",
  provider_opted_out: "Provider opted out of alerts",
};

export function JobTimeline({ events }: { events: JobEvent[] }) {
  if (!events.length)
    return (
      <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
    );
  return (
    <ol className="space-y-4">
      {events.map((event) => (
        <li key={event.id} className="relative pl-5">
          <span
            aria-hidden="true"
            className="absolute top-1.5 left-0 size-2 rounded-full bg-foreground"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              {eventLabels[event.kind] ?? event.kind}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {displayDate(event.createdAt)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {[event.actorName, event.channel && channelLabel(event.channel)]
              .filter(Boolean)
              .join(" · ") || "System"}
          </p>
          {event.note && (
            <p className="mt-1 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              {event.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

export function channelLabel(channel: string) {
  return (
    {
      app: "Driver app",
      dashboard: "Dashboard",
      web: "Web link",
      whatsapp: "WhatsApp",
      system: "System",
    }[channel] ?? channel
  );
}
