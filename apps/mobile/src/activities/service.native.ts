import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import {
  ApiError,
  request,
  uploadPhotoMultipart,
  type DriverContext,
  type Session,
} from "../lib/api";
import type { CapturedPhoto } from "../lib/photos";
import { keys, read, write } from "../lib/storage";
import { activityOutbox } from "./db";
import type { Context, Data, Receipt } from "./queue";

export type Entry = {
  id: string;
  name: string;
  active: boolean;
  unit?: string;
  siteType?: string;
  directions?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type Catalogue = {
  customers: Entry[];
  products: Entry[];
  locations: Entry[];
  customerProducts: {
    customerId: string;
    productId: string;
    supplies?: boolean;
    receives?: boolean;
  }[];
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

export const ACTIVITY_UPLOAD_TASK = "fleet-activity-upload-v1";

let flushing: Promise<void> | undefined;
let recordingEpoch = 0;
let lifecycle: Promise<unknown> = Promise.resolve();
let lastSyncAt: number | null = null;
let lastSyncError: string | null = null;

function recordingChange<T>(action: () => Promise<T>) {
  const next = lifecycle.then(action, action);
  lifecycle = next.catch(() => {});
  return next;
}

async function captureBestEffortGps() {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      return { latitude: null, longitude: null, accuracy: null };
    }
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 300_000,
      requiredAccuracy: 1000,
    });
    const position =
      last ??
      (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }));
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    };
  } catch {
    return { latitude: null, longitude: null, accuracy: null };
  }
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
  ) {
    return;
  }
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
    !(await TaskManager.isTaskRegisteredAsync(ACTIVITY_UPLOAD_TASK))
  ) {
    await BackgroundTask.registerTaskAsync(ACTIVITY_UPLOAD_TASK, {
      minimumInterval: 15,
    });
  }
}

export async function refreshActivities(session: Session, driverId: string) {
  const q = await activityOutbox();
  const results = await Promise.allSettled([
    request<Catalogue>("transport/catalogue", {
      session: session.sessionToken,
    }),
    request<Job[]>("transport/dispatches", { session: session.sessionToken }),
  ]);
  if (results[0].status === "fulfilled") {
    await q.cache(`catalogue:${driverId}`, results[0].value);
  }
  if (results[1].status === "fulfilled") {
    await q.cache(`jobs:${driverId}`, results[1].value);
  }
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
    ).catch(() => []);
    if (reviews.length) await q.reviews(reviews);
  }
}

export async function saveActivity(
  contextId: string,
  recordId: string,
  data: Data,
  photo?: { file: CapturedPhoto; kind: string } | null,
) {
  const q = await activityOutbox();
  const gps =
    data.latitude == null && data.longitude == null
      ? await captureBestEffortGps()
      : {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy,
        };
  const event = await q.append(contextId, recordId, {
    ...data,
    latitude: gps.latitude,
    longitude: gps.longitude,
    accuracy: gps.accuracy,
  });
  if (photo) {
    await q.queueAttachment({
      ownerType: "record",
      ownerId: recordId,
      contextId,
      kind: photo.kind,
      localUri: photo.file.uri,
      mimeType: photo.file.mimeType,
    });
  }
  void syncActivities(true);
  return event;
}

export async function queueShiftPhoto(
  sessionId: string,
  photo: CapturedPhoto,
  kind: "start_odometer_photo" | "end_odometer_photo",
) {
  const q = await activityOutbox();
  await q.queueAttachment({
    ownerType: "shift",
    ownerId: sessionId,
    contextId: null,
    kind,
    localUri: photo.uri,
    mimeType: photo.mimeType,
  });
  void syncActivities(true);
}

export async function stopRecording() {
  recordingEpoch++;
  await recordingChange(async () => {
    await (await activityOutbox()).stop();
  });
}

async function flush(force: boolean) {
  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || net.isInternetReachable === false) return;
  const q = await activityOutbox();

  // 1. Drain pending activity JSON batches
  for (let i = 0; i < 10; i++) {
    const batch = await q.pendingBatch(force);
    if (!batch || !batch.events.length) break;
    const token = await read(`fleet.recording-token.${batch.contextId}`);
    if (!token) {
      await q.applyReceipt({
        accepted: [],
        rejected: batch.events.map((e) => ({
          id: e.id,
          reason: "Recording credentials expired on this phone.",
        })),
        stopCapture: true,
        receivedAt: new Date().toISOString(),
      });
      continue;
    }
    try {
      const receipt = await request<Receipt>("transport/batches", {
        method: "POST",
        recording: token,
        body: batch,
      });
      await q.applyReceipt(receipt);
      lastSyncAt = Date.now();
      lastSyncError = null;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await q.stop();
        lastSyncError = "Confirm your vehicle online to resume syncing.";
        return;
      }
      await q.backoffEvents(batch.events.map((e) => e.id));
      lastSyncError =
        cause instanceof Error ? cause.message : "Could not sync activities.";
      return;
    }
  }

  // 2. Drain queued POD / weighbridge / fuel / expense / odometer photos
  const photos = await q.pendingAttachments(force);
  if (!photos.length) return;
  const storedSession = await read(keys.session);
  const sessionToken = storedSession
    ? (JSON.parse(storedSession) as Session).sessionToken
    : undefined;

  for (const photo of photos) {
    try {
      if (photo.owner_type === "record" && photo.context_id) {
        const token = await read(`fleet.recording-token.${photo.context_id}`);
        if (!token) {
          await q.markAttachmentFailed(
            photo.id,
            "Recording token unavailable.",
            true,
          );
          continue;
        }
        await uploadPhotoMultipart(
          `transport/records/${photo.owner_id}/attachments`,
          {
            uri: photo.local_uri,
            mimeType: photo.mime_type,
            kind: photo.kind,
            recording: token,
            recordingContextId: photo.context_id,
          },
        );
      } else if (photo.owner_type === "shift" && sessionToken) {
        await uploadPhotoMultipart(
          `transport/shifts/${photo.owner_id}/attachments`,
          {
            uri: photo.local_uri,
            mimeType: photo.mime_type,
            kind: photo.kind,
            session: sessionToken,
          },
        );
      } else {
        continue;
      }
      await q.markAttachmentUploaded(photo.id);
      lastSyncAt = Date.now();
      lastSyncError = null;
    } catch (cause) {
      const permanent =
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        cause.status !== 401;
      await q.markAttachmentFailed(
        photo.id,
        cause instanceof Error ? cause.message : "Photo upload failed.",
        permanent,
      );
    }
  }
}

export function syncActivities(force = false) {
  flushing ??= flush(force).finally(() => {
    flushing = undefined;
  });
  return flushing;
}

export async function getActivitySyncStatus() {
  const q = await activityOutbox();
  const c = await q.counts();
  return {
    pending: c.pending,
    blocked: c.blocked,
    pendingPhotos: c.pendingPhotos,
    syncing: Boolean(flushing),
    lastSync: lastSyncAt,
    error: lastSyncError,
  };
}
