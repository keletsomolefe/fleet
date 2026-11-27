import { useAttention, type Attention } from "@/lib/use-attention";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import {
  ApiError,
  request,
  type DriverContext,
  type Session,
  type Truck,
} from "@/lib/api";
import type { CapturedPhoto } from "@/lib/photos";
import { keys, read, remove, write } from "@/lib/storage";
import { stopTracking, reconcileDriverContext } from "@/tracking/service";
import {
  prepareRecording,
  queueShiftPhoto,
  refreshActivities,
  stopRecording,
  syncActivities,
} from "@/activities/service";

export type StartDrivingOptions = {
  startOdometerKm?: string | null;
  startOdometerMissingPhotoReason?: string | null;
  startPhoto?: CapturedPhoto | null;
  previousEndOdometerKm?: string | null;
  previousEndOdometerMissingPhotoReason?: string | null;
  previousEndOdometerLowerReason?: string | null;
  previousEndPhoto?: CapturedPhoto | null;
};

export type FinishDrivingOptions = {
  endOdometerKm?: string | null;
  endOdometerMissingPhotoReason?: string | null;
  endOdometerLowerReason?: string | null;
  endPhoto?: CapturedPhoto | null;
};

type Selection = {
  truck: Truck;
  id: string;
  expectedOwnSessionId: string | null;
};

type FleetState = {
  attention: Attention;
  refreshAttention: () => Promise<void>;
  reportMismatch: (
    requestedTruckId: string | null,
    note: string,
  ) => Promise<void>;
  ready: boolean;
  session: Session | null;
  driver: DriverContext | null;
  error: string;
  selection: Selection | null;
  selectTruck: (truck: Truck) => void;
  refresh: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<"/truck" | "/admin">;
  logout: () => Promise<void>;
  startDriving: (options?: StartDrivingOptions) => Promise<void>;
  finishDriving: (options?: FinishDrivingOptions) => Promise<void>;
  flagVehicle: () => Promise<void>;
};

const Context = createContext<FleetState | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [driver, setDriver] = useState<DriverContext | null>(null),
    [error, setError] = useState(""),
    [selection, setSelection] = useState<Selection | null>(null);
  const { attention, refreshAttention } = useAttention(session);
  const sessionRef = useRef<Session | null>(null),
    generation = useRef(0);

  const refresh = useCallback(async () => {
    const current = sessionRef.current,
      ticket = generation.current;
    if (!current) return;
    try {
      const access = await request<Omit<Session, "sessionToken">>(
        "auth/session",
        { session: current.sessionToken },
      );
      if (ticket !== generation.current) return;
      const updated = { ...access, sessionToken: current.sessionToken };
      await write(keys.session, JSON.stringify(updated));
      if (ticket !== generation.current) return;
      sessionRef.current = updated;
      setSession(updated);
      if (access.mode === "driver") {
        const next = await request<DriverContext>("driver/context", {
          session: current.sessionToken,
        });
        if (ticket !== generation.current) return;
        await reconcileDriverContext(next);
        if (ticket !== generation.current) return;
        setDriver(next);
        await write(
          `fleet.driver-context.${current.user.id}`,
          JSON.stringify(next),
        );
        if (next.confirmedAt && next.drivingSession?.onThisPhone) {
          void prepareRecording(
            updated,
            next,
            () => ticket === generation.current,
          )
            .then(() => refreshActivities(updated, next.driver.id))
            .then(() => syncActivities())
            .catch(() => undefined);
        } else {
          void stopRecording().catch(() => undefined);
        }
      } else {
        await stopTracking("access_changed");
        await stopRecording();
        setDriver(null);
      }
      setError("");
    } catch (cause) {
      if (ticket !== generation.current) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
        setDriver(null);
        await remove(`fleet.driver-context.${current.user.id}`);
        await stopTracking("access_ended");
        await stopRecording();
        await remove(keys.session);
        sessionRef.current = null;
        setSession(null);
        setSelection(null);
        generation.current++;
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh your driving session.",
      );
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const invalidate = () => {
      generation.current++;
    };
    void (async () => {
      try {
        if (Platform.OS === "web") return;
        const stored = await read(keys.session);
        if (!mounted) return;
        if (stored) {
          const raw = JSON.parse(stored) as Session & { mode: string };
          const value: Session = {
            ...raw,
            mode: raw.mode === "driver" ? "driver" : "admin",
            permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
          };
          if (!value.sessionToken) throw new Error("Please sign in again.");
          sessionRef.current = value;
          setSession(value);
          const cached = await read(`fleet.driver-context.${value.user.id}`);
          if (cached && value.mode === "driver")
            setDriver(JSON.parse(cached) as DriverContext);
          if (mounted) setReady(true);
          await refresh();
        } else {
          await stopTracking("signed_out");
          await stopRecording();
        }
      } catch (cause) {
        if (mounted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not read secure storage.",
          );
      } finally {
        if (mounted) setReady(true);
      }
    })();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
        void syncActivities().catch(() => undefined);
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 20000);
    return () => {
      mounted = false;
      invalidate();
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  async function login(identifier: string, password: string) {
    const next = await request<Session>("auth/login", {
      method: "POST",
      body: { identifier, password },
    });
    try {
      await stopTracking("account_changed");
      await stopRecording();
      await write(keys.session, JSON.stringify(next));
    } catch (cause) {
      await request("auth/session", {
        method: "DELETE",
        session: next.sessionToken,
      }).catch(() => undefined);
      throw cause;
    }
    generation.current++;
    sessionRef.current = next;
    setSession(next);
    setSelection(null);
    setDriver(null);
    setError("");
    await refresh();
    if (!sessionRef.current) throw new Error("Please sign in again.");
    return sessionRef.current.mode === "admin"
      ? ("/admin" as const)
      : ("/truck" as const);
  }

  async function logout() {
    generation.current++;
    await stopTracking("signed_out");
    await stopRecording();
    const current = sessionRef.current;
    if (current)
      await request("auth/session", {
        method: "DELETE",
        session: current.sessionToken,
      });
    await remove(keys.session);
    generation.current++;
    sessionRef.current = null;
    setSession(null);
    setDriver(null);
    setSelection(null);
    setError("");
  }

  async function startDriving(options?: StartDrivingOptions) {
    if (!sessionRef.current || !selection)
      throw new Error("Choose a vehicle first.");
    const previousSessionId = driver?.drivingSession?.id ?? null;
    await stopTracking("vehicle_changed");
    await stopRecording();
    generation.current++;
    try {
      const next = await request<DriverContext>("driver/driving-sessions", {
        method: "POST",
        session: sessionRef.current.sessionToken,
        body: {
          id: selection.id,
          truckId: selection.truck.id,
          expectedOwnSessionId: selection.expectedOwnSessionId,
          expectedScheduleId: driver?.schedule?.id ?? null,
          ...(options?.startOdometerKm != null
            ? { startOdometerKm: options.startOdometerKm }
            : {}),
          ...(options?.startOdometerMissingPhotoReason
            ? {
                startOdometerMissingPhotoReason:
                  options.startOdometerMissingPhotoReason,
              }
            : {}),
          ...(options?.startPhoto ? { hasStartPhoto: true } : {}),
          ...(options?.previousEndOdometerKm != null
            ? { previousEndOdometerKm: options.previousEndOdometerKm }
            : {}),
          ...(options?.previousEndOdometerMissingPhotoReason
            ? {
                previousEndOdometerMissingPhotoReason:
                  options.previousEndOdometerMissingPhotoReason,
              }
            : {}),
          ...(options?.previousEndOdometerLowerReason
            ? {
                previousEndOdometerLowerReason:
                  options.previousEndOdometerLowerReason,
              }
            : {}),
          ...(options?.previousEndPhoto ? { hasPreviousEndPhoto: true } : {}),
        },
      });
      generation.current++;
      setDriver(next);
      await write(
        `fleet.driver-context.${sessionRef.current!.user.id}`,
        JSON.stringify(next),
      );
      if (options?.previousEndPhoto && previousSessionId) {
        void queueShiftPhoto(
          previousSessionId,
          options.previousEndPhoto,
          "end_odometer_photo",
        ).catch(() => undefined);
      }
      if (options?.startPhoto && next.drivingSession) {
        void queueShiftPhoto(
          next.drivingSession.id,
          options.startPhoto,
          "start_odometer_photo",
        ).catch(() => undefined);
      }
      if (next.confirmedAt && next.drivingSession?.onThisPhone) {
        void prepareRecording(sessionRef.current, next)
          .then(() => refreshActivities(sessionRef.current!, next.driver.id))
          .catch(() => undefined);
      }
      setSelection(null);
      setError("");
    } catch (cause) {
      await refresh();
      throw cause;
    }
  }

  async function finishDriving(options?: FinishDrivingOptions) {
    if (!sessionRef.current || !driver?.drivingSession)
      throw new Error("Refresh your vehicle details, then try again.");
    const endedSessionId = driver.drivingSession.id;
    await stopTracking("driver_released");
    await stopRecording();
    generation.current++;
    const next = await request<DriverContext>("driver/driving-sessions/end", {
      method: "POST",
      session: sessionRef.current.sessionToken,
      body: {
        sessionId: endedSessionId,
        ...(options?.endOdometerKm != null
          ? { endOdometerKm: options.endOdometerKm }
          : {}),
        ...(options?.endOdometerMissingPhotoReason
          ? {
              endOdometerMissingPhotoReason:
                options.endOdometerMissingPhotoReason,
            }
          : {}),
        ...(options?.endOdometerLowerReason
          ? { endOdometerLowerReason: options.endOdometerLowerReason }
          : {}),
        ...(options?.endPhoto ? { hasEndPhoto: true } : {}),
      },
    });
    if (options?.endPhoto) {
      void queueShiftPhoto(
        endedSessionId,
        options.endPhoto,
        "end_odometer_photo",
      ).catch(() => undefined);
    }
    generation.current++;
    setDriver(next);
    setSelection(null);
    setError("");
  }

  async function flagVehicle() {
    if (!sessionRef.current || !selection)
      throw new Error("Choose a vehicle first.");
    await request(`driver/vehicles/${selection.truck.id}/flag`, {
      method: "POST",
      session: sessionRef.current.sessionToken,
      body: { sessionId: selection.truck.activeSession?.id },
    });
  }

  async function reportMismatch(requestedTruckId: string | null, note: string) {
    if (!driver?.schedule || !sessionRef.current)
      throw new Error("Refresh your schedule first.");
    await stopTracking("schedule_dispute");
    await stopRecording();
    generation.current++;
    await request("driver/schedule-mismatch", {
      method: "POST",
      session: sessionRef.current.sessionToken,
      body: { expectedScheduleId: driver.schedule.id, requestedTruckId, note },
    });
    await refresh();
  }

  return (
    <Context.Provider
      value={{
        attention,
        refreshAttention,
        reportMismatch,
        ready,
        session,
        driver,
        error,
        selection,
        selectTruck: (truck) =>
          setSelection({
            truck,
            id: Crypto.randomUUID(),
            expectedOwnSessionId: driver?.drivingSession?.id ?? null,
          }),
        refresh,
        login,
        logout,
        startDriving,
        finishDriving,
        flagVehicle,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useFleet() {
  const state = useContext(Context);
  if (!state) throw new Error("FleetProvider is missing.");
  return state;
}
