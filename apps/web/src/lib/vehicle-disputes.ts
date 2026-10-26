import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseHeader,
} from "@tanstack/react-start/server";
export const issueLabels = {
  vehicle: "Vehicle problem",
  safety: "Safety concern",
  other: "Other issue",
};
export interface DriverIssue {
  id: string;
  kind: "issue";
  category: keyof typeof issueLabels;
  description: string;
  truck: VehicleDispute["truck"] | null;
  requestedBy: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}
export interface VehicleDispute {
  kind: "occupancy" | "schedule";
  scheduleDate: string | null;
  driverNote: string | null;
  requestedTruck: { id: string; registration: string } | null;
  schedule: { id: string; truckId: string } | null;
  requestedTruckSession: { id: string; driverName: string } | null;
  requestedScheduleId: string | null;
  requestedScheduledDriver: string | null;
  id: string;
  truck: {
    id: string;
    registration: string;
    identifier: string;
    make: string;
    model: string;
  };
  requestedBy: string;
  currentDriver: { id: string; driverName: string; startedAt: string } | null;
  createdAt: string;
}
export const getVehicleDisputes = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    items: (VehicleDispute | DriverIssue)[];
    error?: string;
  }> => {
    setResponseHeader("Cache-Control", "private, no-store");
    try {
      const responses = await Promise.all(
        ["vehicle-disputes", "issues"].map((path) =>
          fetch(new URL(`api/admin/${path}`, process.env.APP_URL), {
            headers: { Cookie: getRequestHeader("cookie") ?? "" },
            signal: AbortSignal.timeout(8000),
          }),
        ),
      );
      if (responses.some((r) => !r.ok))
        return {
          items: [],
          error: responses.some((r) => r.status === 403)
            ? "You do not have access to these items."
            : "Could not load items.",
        };
      const [disputes, issues] = (await Promise.all(
        responses.map((r) => r.json()),
      )) as [{ items: VehicleDispute[] }, { items: DriverIssue[] }];
      return {
        items: [...disputes.items, ...issues.items].sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        ),
      };
    } catch {
      return {
        items: [],
        error: "Could not load items. Please try again.",
      };
    }
  },
);
