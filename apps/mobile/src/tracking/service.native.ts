import { AppState, Linking } from "react-native";
import * as Location from "expo-location";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import mqtt, { type MqttClient } from "mqtt";
import { ApiError, request, type DriverContext, type Session } from "@/lib/api";
import { keys, read, write, remove } from "@/lib/storage";
import { outbox } from "./db";
import {
  emptyStatus,
  type Batch,
  type Receipt,
  type TrackingStatus,
} from "./types";

export const LOCATION_TASK = "fleet-location-v1",
  UPLOAD_TASK = "fleet-location-upload-v1";
let client: MqttClient | undefined,
  connectionKey = "",
  flushPromise: Promise<void> | undefined,
  operation: Promise<unknown> = Promise.resolve();
let receiptWaiter:
  | { batch: Batch; resolve: (r: Receipt) => void; reject: (e: Error) => void }
  | undefined;
async function exclusive<T>(action: () => Promise<T>) {
  const result = operation.then(action, action);
  operation = result.catch(() => undefined);
  return result;
}
async function recordError(cause: unknown) {
  const message =
    cause instanceof Error
      ? cause.message
      : "Location sharing needs attention.";
  try {
    await (await outbox()).meta("error", message);
  } catch {
    /* A storage failure must remain visible even when SQLite cannot record it. */
  }
  memoryError = message;
}
let memoryError = "";
async function connect(token: string) {
  const q = await outbox();
  const config = await request<{ deviceId: string; mqttUrl: string | null }>(
    "telemetry/config",
    { device: token },
  );
  if (!config.mqttUrl) return;
  const key = `${config.deviceId}:${token}:${config.mqttUrl}`;
  if (client && connectionKey === key) return;
  client?.end(true);
  connectionKey = key;
  const socket = mqtt.connect(config.mqttUrl, {
    username: config.deviceId,
    password: token,
    clientId: `fleet-${config.deviceId}-${Crypto.randomUUID().slice(0, 8)}`,
    protocolVersion: 4,
    clean: true,
    keepalive: 30,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    queueQoSZero: false,
    forceNativeWebSocket: true,
  });
  client = socket;
  socket.on("connect", () => {
    socket.subscribe(
      `fleet/devices/${config.deviceId}/receipts`,
      { qos: 1 },
      (error) => {
        if (error) return;
        void q
          .meta("transport", "MQTT")
          .then(() => flush())
          .catch(recordError);
      },
    );
  });
  socket.on("message", (_topic, payload) => {
    try {
      const r = JSON.parse(payload.toString()) as Receipt;
      if (receiptWaiter?.batch.batchId === r.batchId) receiptWaiter.resolve(r);
    } catch {
      receiptWaiter?.reject(new Error("Invalid MQTT receipt."));
    }
  });
  socket.on("error", () => {
    void q.meta("transport", "Retrying over HTTPS").catch(() => undefined);
  });
  socket.on("close", () => {
    receiptWaiter?.reject(new Error("MQTT connection closed."));
    void q.meta("transport", "Disconnected").catch(() => undefined);
  });
  socket.on("offline", () => {
    void q.meta("transport", "Offline").catch(() => undefined);
  });
}
async function sendMqtt(batch: Batch, deviceId: string): Promise<Receipt> {
  const socket = client;
  if (!socket?.connected) throw new Error("MQTT is not connected.");
  return new Promise<Receipt>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (receiptWaiter?.batch.batchId === batch.batchId)
        receiptWaiter = undefined;
      reject(new Error("Waiting for a durable location receipt."));
    }, 8000);
    const finish = (action: () => void) => {
      clearTimeout(timer);
      if (receiptWaiter?.batch.batchId === batch.batchId)
        receiptWaiter = undefined;
      action();
    };
    receiptWaiter = {
      batch,
      resolve: (r) => finish(() => resolve(r)),
      reject: (e) => finish(() => reject(e)),
    };
    // The publish callback is deliberately not used to acknowledge the SQLite records.
    socket.publish(
      `fleet/devices/${deviceId}/locations`,
      JSON.stringify(batch),
      { qos: 1, retain: false },
      (error) => {
        if (error) finish(() => reject(error));
      },
    );
  });
}
async function flushNow() {
  const q = await outbox();
  const network = await Network.getNetworkStateAsync();
  if (network.isConnected === false || network.isInternetReachable === false) {
    await q.meta("transport", "Offline");
    return;
  }
  const status = await q.status();
  if (!status.pending && !status.active) {
    const end = await q.batch();
    if (!end) return;
  }
  // MQTT stays live while the app is running; a headless callback can always use HTTP immediately.
  for (let n = 0; n < (AppState.currentState === "active" ? 10 : 1); n++) {
    const batch = await q.batch();
    if (!batch) break;
    // Each historical stream keeps its own upload capability across vehicle/account changes.
    const token =
      (await read(`fleet.tracking-token.${batch.streamId}`)) ??
      (await read(keys.device));
    if (!token) {
      await q.failed(
        batch,
        "Some saved locations could not be sent. Contact your administrator.",
      );
      break;
    }
    void connect(token).catch(() => undefined);
    try {
      let r: Receipt | undefined;
      const stream =
        status.active?.id === batch.streamId ? status.active : null;
      if (client?.connected && connectionKey.split(":")[1] === token) {
        const deviceId = stream?.device_id ?? connectionKey.split(":")[0];
        try {
          r = await sendMqtt(batch, deviceId);
        } catch {
          /* Same immutable event IDs make HTTP fallback safe even after an unknown MQTT commit. */
        }
      }
      if (!r) {
        r = await request<Receipt>("telemetry/batches", {
          method: "POST",
          device: token,
          body: batch,
        });
        await q.meta("transport", "HTTPS");
      }
      await q.receipt(batch, r);
      if (!locationUnavailable) {
        await q.meta("error", "");
        memoryError = "";
      }
      if (
        !r.captureAllowed &&
        !batch.end &&
        (await q.active())?.id === batch.streamId
      ) {
        await stopCapture("server_revoked");
      }
    } catch (cause) {
      await q.failed(
        batch,
        cause instanceof Error ? cause.message : "Upload failed.",
      );
      if (cause instanceof ApiError && [401, 403].includes(cause.status))
        await stopCapture("device_access_ended");
      break;
    }
  }
  await q.pruneAcknowledged();
  if (
    !(await q.active()) &&
    !(await q.status()).pending &&
    !(await q.batch())
  ) {
    client?.end(true);
    client = undefined;
    connectionKey = "";
    await q.meta("transport", "Disconnected");
  }
}
export async function syncLocationLog() {
  await (await outbox()).retryNow();
  await flush();
}
export function flush() {
  if (!flushPromise)
    flushPromise = flushNow()
      .catch(recordError)
      .finally(() => {
        flushPromise = undefined;
      });
  return flushPromise;
}
async function stopCapture(reason: string) {
  // Persist the stop boundary first so a late callback cannot be attributed to a new driver.
  const q = await outbox();
  await q.stop(reason);
  await remove("fleet.tracking-start.v1");
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
export async function stopTracking(reason = "driver_stopped") {
  return exclusive(async () => {
    await stopCapture(reason);
    void flush();
  });
}
async function activate() {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 10000,
    distanceInterval: 0,
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: "Fleet location sharing",
      notificationBody:
        "Recording this truck’s route. Open Fleet to stop sharing.",
      notificationColor: "#0B0B0B",
      killServiceOnDestroy: false,
    },
  });
  if (
    (await BackgroundTask.getStatusAsync()) ===
      BackgroundTask.BackgroundTaskStatus.Available &&
    !(await TaskManager.isTaskRegisteredAsync(UPLOAD_TASK))
  )
    await BackgroundTask.registerTaskAsync(UPLOAD_TASK, {
      minimumInterval: 15,
    });
}
export async function startTracking(session: Session, driver: DriverContext) {
  return exclusive(async () => {
    if (
      !driver.confirmedAt ||
      !driver.canDrive ||
      !driver.truck ||
      !driver.drivingSession?.onThisPhone
    )
      throw new Error("Confirm your truck before sharing location.");
    if (!(await Location.hasServicesEnabledAsync()))
      throw new Error("Turn on device location, then try again.");
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (
      foreground.status !== "granted" ||
      foreground.android?.accuracy === "coarse" ||
      foreground.ios?.accuracy === "reduced"
    )
      throw new Error("Allow precise location in device settings.");
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== "granted")
      throw new Error("Allow location all the time in device settings.");
    const q = await outbox(),
      active = await q.active();
    if (active) {
      if (
        active.driver_id !== driver.driver.id ||
        active.driving_session_id !== driver.drivingSession?.id
      )
        throw new Error("Stop location sharing before starting again.");
      if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)))
        await activate();
      return;
    }
    const intent = await readTrackingIntent(
      driver.driver.id,
      driver.drivingSession!.id,
    );
    const stream = await request<{
      id: string;
      deviceId: string;
      driverId: string;
      associationId: string;
      startedAt: string;
    }>("telemetry/streams", {
      method: "POST",
      session: session.sessionToken,
      body: {
        streamId: intent.id,
        drivingSessionId: driver.drivingSession!.id,
        uploadToken: intent.uploadToken,
      },
    });
    await write(`fleet.tracking-token.${stream.id}`, intent.uploadToken);
    await q.addStream({
      id: stream.id,
      device_id: stream.deviceId,
      driver_id: stream.driverId,
      truck_id: driver.truck.id,
      association_id: stream.associationId,
      driving_session_id: driver.drivingSession!.id,
      started_at: Math.max(Date.now(), Date.parse(stream.startedAt)),
    });
    await remove("fleet.tracking-start.v1");
    await q.statusEvent("tracking_started", { sampleIntervalMs: 10000 });
    try {
      await activate();
      await q.meta("error", "");
      memoryError = "";
      void flush();
    } catch (cause) {
      await stopCapture("start_failed");
      await recordError(cause);
      throw cause;
    }
  });
}
async function readTrackingIntent(driverId: string, associationId: string) {
  // A stable request ID makes a lost start response safe to retry.
  const key = "fleet.tracking-start.v1";
  const old = await read(key);
  let value: {
    id: string;
    driverId: string;
    associationId: string;
    uploadToken: string;
  } | null = null;
  try {
    value = old ? JSON.parse(old) : null;
  } catch {}
  if (
    !value ||
    value.driverId !== driverId ||
    value.associationId !== associationId ||
    !value.uploadToken
  )
    value = {
      id: Crypto.randomUUID(),
      driverId,
      associationId,
      uploadToken: Array.from(await Crypto.getRandomBytesAsync(32), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    };
  await write(key, JSON.stringify(value));
  return value;
}
export async function capture(locations: Location.LocationObject[]) {
  const q = await outbox();
  const current = await q.active();
  if (current) {
    // Johannesburg has no daylight-saving transition. End offline capture at the confirmed day's boundary.
    const localStart = new Date(current.started_at + 2 * 3600000);
    const cutoff =
      Date.UTC(
        localStart.getUTCFullYear(),
        localStart.getUTCMonth(),
        localStart.getUTCDate() + 1,
      ) -
      2 * 3600000;
    if (Date.now() >= cutoff) {
      await q.stop("daily_confirmation_required", cutoff);
      await stopCapture("daily_confirmation_required");
    }
  }
  const records = locations as unknown as {
    timestamp: number;
    coords: Record<string, unknown>;
    [key: string]: unknown;
  }[];
  for (let attempt = 0; ; attempt++) {
    try {
      await q.locations(records);
      break;
    } catch (cause) {
      if (attempt >= 3) {
        if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))
          await Location.stopLocationUpdatesAsync(LOCATION_TASK);
        await recordError(
          new Error(
            `Could not save ${records.length} GPS records. Free device storage and reopen Fleet.`,
          ),
        );
        throw cause;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  await flush();
}
export async function reconcileDriverContext(driver: DriverContext) {
  const active = await (await outbox()).active();
  if (
    active &&
    (active.driver_id !== driver.driver.id ||
      active.driving_session_id !== driver.drivingSession?.id ||
      !driver.canDrive ||
      !driver.confirmedAt)
  )
    await stopTracking("truck_context_changed");
}
export async function taskError(message: string) {
  await recordError(new Error(message));
  await (
    await outbox()
  ).statusEvent("location_task_error", { message: message.slice(0, 1000) });
}
export async function getTrackingStatus(): Promise<TrackingStatus> {
  try {
    const state = await (await outbox()).status();
    const collecting =
      !!state.active &&
      (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) &&
      (await Location.getBackgroundPermissionsAsync()).status === "granted" &&
      (await Location.hasServicesEnabledAsync());
    return { ...state, collecting, error: memoryError || state.error };
  } catch (cause) {
    return {
      ...emptyStatus,
      error:
        cause instanceof Error
          ? cause.message
          : "Could not read the location log.",
    };
  }
}
export const openLocationSettings = () => Linking.openSettings();
let locationUnavailable = false;
export async function reconcileTracking() {
  const q = await outbox(),
    active = await q.active();
  if (active && !active.driving_session_id) {
    await stopTracking("personal_phone_upgrade");
    await flush();
    return;
  }
  if (active) {
    const permission = await Location.getBackgroundPermissionsAsync();
    if (
      permission.status !== "granted" ||
      !(await Location.hasServicesEnabledAsync())
    ) {
      if (!locationUnavailable) await q.statusEvent("location_unavailable");
      locationUnavailable = true;
      await recordError(
        new Error(
          "Location sharing needs precise and background location access.",
        ),
      );
      await flush();
      return;
    }
    if (locationUnavailable) {
      locationUnavailable = false;
      await q.statusEvent("location_restored");
    }
    if (
      AppState.currentState === "active" &&
      !(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))
    ) {
      await q.statusEvent("tracking_restarted");
      await activate();
    }
  }
  await flush();
}
export function watchTracking() {
  void reconcileTracking().catch(recordError);
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") void reconcileTracking().catch(recordError);
  });
  const network = Network.addNetworkStateListener((state) => {
    if (state.isConnected) void flush();
  });
  const timer = setInterval(() => {
    if (AppState.currentState === "active")
      void reconcileTracking().catch(recordError);
  }, 15000);
  return () => {
    subscription.remove();
    network.remove();
    clearInterval(timer);
  };
}
