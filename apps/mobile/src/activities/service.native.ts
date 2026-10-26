import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { stopTracking } from "../tracking/service";
import { request, type DriverContext, type Session } from "../lib/api";
import { read, write } from "../lib/storage";
import { activityOutbox } from "./db";
import type { Context, Data, Receipt } from "./queue";
export type Entry = {
  id: string;
  name: string;
  active: boolean;
  unit?: string;
  directions?: string;
  latitude?: number;
  longitude?: number;
};
export type Catalogue = {
  customers: Entry[];
  products: Entry[];
  locations: Entry[];
  customerProducts: { customerId: string; productId: string }[];
  units: string[];
};
export type Job = {
  allocationConflict?: boolean;
  id: string;
  reference: string;
  date: string;
  plan: {
    customer: Data["customer"];
    product: Data["product"];
    supplier: Data["supplier"];
    origin: Data["origin"];
    unit: string;
    quantity: string;
    instructions: string;
    collectionId: string;
    deliveries: {
      id: string;
      destination: Data["destination"];
      receiver: Data["receiver"];
      quantity: string;
      collectedQuantity: string | null;
    }[];
  };
};
const task = "fleet-activity-upload-v1";
let flushing: Promise<void> | undefined;
let recordingEpoch = 0,
  lifecycle: Promise<unknown> = Promise.resolve();
function recordingChange<T>(action: () => Promise<T>) {
  const next = lifecycle.then(action, action);
  lifecycle = next.catch(() => {});
  return next;
}
export async function prepareRecording(
  session: Session,
  driver: DriverContext,
  isCurrent: () => boolean = () => true,
) {
  const epoch = recordingEpoch;
  if (!isCurrent()) return;
  if (
    !driver.confirmedAt ||
    !driver.truck ||
    !driver.drivingSession?.onThisPhone
  )
    return;
  const q = await activityOutbox();
  const current = await q.active();
  if (current?.drivingSessionId === driver.drivingSession.id) return;
  const intentKey = `fleet.recording-intent.${driver.drivingSession.id}`;
  const saved = await read(intentKey);
  const intent = saved
    ? (JSON.parse(saved) as { id: string; token: string })
    : {
        id: Crypto.randomUUID(),
        token: Array.from(await Crypto.getRandomBytesAsync(32), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      };
  await write(intentKey, JSON.stringify(intent));
  const context = await request<Omit<Context, "drivingSessionId">>(
    "transport/contexts",
    { session: session.sessionToken, method: "POST", body: intent },
  );
  await write(`fleet.recording-token.${context.id}`, intent.token);
  await recordingChange(async () => {
    if (epoch !== recordingEpoch || !isCurrent()) return;
    await q.context({
      ...context,
      drivingSessionId: driver.drivingSession!.id,
    });
  });
  if (
    (await BackgroundTask.getStatusAsync()) ===
      BackgroundTask.BackgroundTaskStatus.Available &&
    !(await TaskManager.isTaskRegisteredAsync(task))
  )
    await BackgroundTask.registerTaskAsync(task, { minimumInterval: 15 });
}
export async function refreshActivities(session: Session, driverId: string) {
  const q = await activityOutbox();
  const results = await Promise.allSettled([
    request<Catalogue>("transport/catalogue", {
      session: session.sessionToken,
    }),
    request<Job[]>("transport/dispatches", { session: session.sessionToken }),
  ]);
  if (results[0].status === "fulfilled")
    await q.cache(`catalogue:${driverId}`, results[0].value);
  if (results[1].status === "fulfilled")
    await q.cache(`jobs:${driverId}`, results[1].value);
  const records = await q.records(driverId);
  if (records.length) {
    const reviews = await request<
      { id: string; version: number; review: string }[]
    >(
      `transport/reviews?ids=${records
        .slice(0, 100)
        .map((r) => r.id)
        .join(",")}`,
      { session: session.sessionToken },
    );
    await q.reviews(reviews);
  }
}
export async function stopRecording() {
  recordingEpoch++;
  await recordingChange(async () => {
    await (await activityOutbox()).stop();
  });
}
export function syncActivities(force = false) {
  flushing ??= flush(force).finally(async () => {
    try {
      await (await activityOutbox()).cache("syncingAt", 0);
    } finally {
      flushing = undefined;
    }
  });
  return flushing;
}
async function flush(force: boolean) {
  const q = await activityOutbox();
  for (let i = 0; i < 30; i++) {
    const batch = await q.batch(force);
    if (!batch) break;
    await q.cache("syncingAt", Date.now());
    const token = await read(`fleet.recording-token.${batch.contextId}`);
    if (!token) {
      await q.failed(batch, "These saved records need help to sync.");
      break;
    }
    try {
      const receipt = await request<Receipt>("transport/batches", {
        method: "POST",
        recording: token,
        body: batch,
      });
      await q.receipt(batch, receipt);
      await q.cache("error", "");
      if (receipt.stopCapture && (await q.active())?.id === batch.contextId) {
        await q.stop();
        await stopTracking("recording_access_ended");
      }
    } catch (e) {
      await q.failed(batch, e instanceof Error ? e.message : "Could not sync.");
      break;
    }
  }
}
export async function saveActivity(recordId: string, data: Data) {
  const q = await activityOutbox(),
    context = await q.active();
  if (!context)
    throw new Error("Confirm your vehicle online before recording.");
  let point: Location.LocationObject | null = null;
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status === "undetermined")
      permission = await Location.requestForegroundPermissionsAsync();
    if (permission.granted)
      point = await Location.getLastKnownPositionAsync({
        maxAge: 120000,
        requiredAccuracy: 200,
      });
  } catch {}
  const existing = (await q.records(context.driverId)).find(
    (x) => x.id === recordId,
  );
  await q.append(existing?.context_id ?? context.id, recordId, {
    ...data,
    latitude: point?.coords.latitude ?? data.latitude,
    longitude: point?.coords.longitude ?? data.longitude,
    accuracy: point?.coords.accuracy ?? data.accuracy,
  });
  void syncActivities().catch(() => {});
}
export function watchActivities() {
  const run = (force = false) => {
    void syncActivities(force).catch(() => {});
  };
  run(true);
  const app = AppState.addEventListener("change", (s) => {
    if (s === "active") run(true);
  });
  const network = Network.addNetworkStateListener((s) => {
    if (s.isConnected) run(true);
  });
  const timer = setInterval(() => {
    if (AppState.currentState === "active") run();
  }, 15000);
  return () => {
    app.remove();
    network.remove();
    clearInterval(timer);
  };
}
export const ACTIVITY_UPLOAD_TASK = task;
