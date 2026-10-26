import type { DriverContext, Session } from "@/lib/api";
import { emptyStatus, type TrackingStatus } from "./types";
export const LOCATION_TASK = "fleet-location-v1",
  UPLOAD_TASK = "fleet-location-upload-v1";
export async function capture(_locations: unknown[]) {}
export async function taskError(_message: string) {}
export async function getTrackingStatus(): Promise<TrackingStatus> {
  return emptyStatus;
}
export async function startTracking(_session: Session, _driver: DriverContext) {
  throw new Error("Location sharing requires the installed VHH Fleet app.");
}
export async function stopTracking(_reason?: string) {}
export async function reconcileDriverContext(_driver: DriverContext) {}
export async function flush() {}
export async function syncLocationLog() {}
export function watchTracking() {
  return () => undefined;
}
export async function openLocationSettings() {}
