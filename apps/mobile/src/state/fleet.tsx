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
import { keys, read, remove, write } from "@/lib/storage";
import { stopTracking, reconcileDriverContext } from "@/tracking/service";

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
  startDriving: () => Promise<void>;
  finishDriving: () => Promise<void>;
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
      } else {
        await stopTracking("access_changed");
        setDriver(null);
      }
      setError("");
    } catch (cause) {
      if (ticket !== generation.current) return;
      setDriver(null);
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
        await stopTracking("access_ended");
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
          // Server refresh replaces any legacy setup mode; no phone-to-truck binding is restored.
          sessionRef.current = value;
          setSession(value);
          await refresh();
        } else await stopTracking("signed_out");
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
      if (state === "active") void refresh();
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
  async function startDriving() {
    if (!sessionRef.current || !selection)
      throw new Error("Choose a vehicle first.");
    await stopTracking("vehicle_changed");
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
        },
      });
      generation.current++;
      setDriver(next);
      setSelection(null);
      setError("");
    } catch (cause) {
      await refresh();
      throw cause;
    }
  }
  async function finishDriving() {
    if (!sessionRef.current || !driver?.drivingSession)
      throw new Error("Refresh your driving session first.");
    await stopTracking("driver_released");
    generation.current++;
    const next = await request<DriverContext>("driver/driving-sessions/end", {
      method: "POST",
      session: sessionRef.current.sessionToken,
      body: { sessionId: driver.drivingSession.id },
    });
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
