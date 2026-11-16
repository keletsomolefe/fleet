import type { Truck } from "./api";

export type IssueCategory = "vehicle" | "safety" | "other";
export const issueLabels: Record<IssueCategory, string> = {
  vehicle: "Breakdown or damage",
  safety: "Safety concern",
  other: "Other issue",
};
export type ServiceType =
  | "mechanical"
  | "tyres"
  | "towing"
  | "electrical"
  | "bodywork"
  | "fuel"
  | "accident"
  | "other";
export const serviceTypeLabels: Record<ServiceType, string> = {
  mechanical: "Mechanical",
  tyres: "Tyres",
  towing: "Towing",
  electrical: "Electrical",
  bodywork: "Body damage",
  fuel: "Fuel",
  accident: "Accident",
  other: "Other",
};
export const serviceTypes = Object.keys(serviceTypeLabels) as ServiceType[];
export type JobStatus =
  | "open"
  | "assigned"
  | "in_progress"
  | "completed"
  | "closed"
  | "cancelled";
export type JobStage = "en_route" | "arrived" | "working";
export interface DriverJob {
  id: string;
  reference: string;
  status: JobStatus;
  serviceType: ServiceType;
  title: string;
  provider: { id: string; companyName: string } | null;
  latestStage: JobStage | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  isActive: boolean;
}
export interface DriverIssue {
  id: string;
  kind: "issue";
  category: IssueCategory;
  description: string;
  truck: Truck | null;
  requestedBy: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  job?: DriverJob | null;
}
export interface ReportResult {
  id: string | null;
  job: DriverJob | null;
  duplicate: boolean;
  alerts: "queued" | "skipped" | "none";
}
export function jobStatusLabel(job: DriverJob | null | undefined) {
  if (!job) return "";
  if (job.status === "open") return "Waiting for a service provider";
  if (job.status === "completed") return "Completed – waiting for the office";
  if (job.status === "closed") return "Closed";
  if (job.status === "cancelled") return "Cancelled";
  if (job.latestStage === "en_route") return "On the way";
  if (job.latestStage === "arrived") return "On site";
  if (job.latestStage === "working") return "Working";
  if (job.status === "assigned")
    return job.provider ? `${job.provider.companyName} accepted` : "Provider accepted";
  return "In progress";
}
