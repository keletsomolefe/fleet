import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseHeader,
} from "@tanstack/react-start/server";
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
  async (): Promise<{ items: VehicleDispute[]; error?: string }> => {
    setResponseHeader("Cache-Control", "private, no-store");
    try {
      const r = await fetch(
        new URL("api/admin/vehicle-disputes", process.env.APP_URL),
        {
          headers: { Cookie: getRequestHeader("cookie") ?? "" },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!r.ok)
        return {
          items: [],
          error:
            r.status === 403
              ? "You do not have access to vehicle flags."
              : "Could not load vehicle flags.",
        };
      return await r.json();
    } catch {
      return {
        items: [],
        error: "Could not load vehicle flags. Please try again.",
      };
    }
  },
);
