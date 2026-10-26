import type { DriverContext, Session } from "../lib/api";
import type { Data } from "./queue";
export type { Catalogue, Entry, Job } from "./service.native";
export const ACTIVITY_UPLOAD_TASK = "fleet-activity-upload-v1";
export async function prepareRecording(
  _session: Session,
  _driver: DriverContext,
  _isCurrent?: () => boolean,
) {}
export async function refreshActivities(_session: Session, _driverId: string) {}
export async function stopRecording() {}
export async function syncActivities(_force = false) {}
export async function saveActivity(_id: string, _data: Data) {
  throw new Error("Open the installed Fleet app to continue.");
}
export function watchActivities() {
  return () => {};
}
