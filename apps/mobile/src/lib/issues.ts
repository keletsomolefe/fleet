import type { Truck } from "./api";

export type IssueCategory = "vehicle" | "safety" | "other";
export const issueLabels: Record<IssueCategory, string> = {
  vehicle: "Vehicle problem",
  safety: "Safety concern",
  other: "Other issue",
};
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
}
