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
  type DeviceContext,
  type DriverContext,
  type Mode,
  type Session,
  type Truck,
} from "@/lib/api";
import { keys, read, remove, write } from "@/lib/storage";
import { stopTracking, reconcileDriverContext } from "@/tracking/service";

type FleetState = {
  ready: boolean;
  session: Session | null;
  device: DeviceContext | null;
  driver: DriverContext | null;
  error: string;
  deviceName: string;
  selection: { truck: Truck; identifier: string } | null;
  selectTruck: (truck: Truck, identifier: string) => void;
  refresh: () => Promise<DeviceContext | null>;
  login: (
    identifier: string,
    password: string,
  ) => Promise<"/setup" | "/setup/ready" | "/truck">;
  logout: () => Promise<void>;
  enroll: (
    truck: Truck,
    identifier: string,
    replaceExisting: boolean,
  ) => Promise<void>;
  confirm: () => Promise<void>;
  clearError: () => void;
};
const Context = createContext<FleetState | null>(null);
export function FleetProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [device, setDevice] = useState<DeviceContext | null>(null),
    [driver, setDriver] = useState<DriverContext | null>(null),
    [error, setError] = useState(""),
    [deviceName, setDeviceName] = useState("");
  const [selection, setSelection] = useState<{
    truck: Truck;
    identifier: string;
  } | null>(null);
  const tokenRef = useRef<string | null>(null),
    sessionRef = useRef<Session | null>(null),
    generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = generation.current,
      token = tokenRef.current;
    let current = sessionRef.current;
    try {
      if (current) {
        let access: { mode: Mode };
        try {
          access = await request<{ mode: Mode }>("auth/session", {
            session: current.sessionToken,
          });
        } catch (cause) {
          if (
            ticket === generation.current &&
            cause instanceof ApiError &&
            [401, 403].includes(cause.status)
          ) {
            if (cause.status === 403) await stopTracking("access_changed");
            await remove(keys.session);
            sessionRef.current = null;
            setSession(null);
          }
          throw cause;
        }
        if (ticket !== generation.current) return null;
        if (access.mode !== current.mode) {
          await stopTracking("access_changed");
          current = { ...current, mode: access.mode };
          await write(keys.session, JSON.stringify(current));
          if (ticket !== generation.current) return null;
          sessionRef.current = current;
          setSession(current);
          setSelection(null);
        }
      }
      const next = token
        ? await request<DeviceContext>("device", { device: token })
        : null;
      if (ticket !== generation.current) return null;
      setDevice(next);
      if (current?.mode === "driver" && token) {
        let profile: DriverContext;
        try {
          profile = await request<DriverContext>("driver/truck", {
            session: current.sessionToken,
            device: token,
          });
        } catch (cause) {
          if (
            ticket === generation.current &&
            cause instanceof ApiError &&
            cause.status === 403
          ) {
            await stopTracking("driver_access_ended");
            await remove(keys.session);
            sessionRef.current = null;
            setSession(null);
          }
          throw cause;
        }
        if (ticket === generation.current) {
          await reconcileDriverContext(profile);
          setDriver(profile);
        }
      } else if (ticket === generation.current) setDriver(null);
      if (ticket === generation.current) setError("");
      return next;
    } catch (cause) {
      if (ticket !== generation.current) return null;
      setDriver(null);
      setDevice(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh this device.",
      );
      return null;
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    const invalidateRequests = () => {
      generation.current++;
    };
    void (async () => {
      try {
        if (Platform.OS === "web") return;
        const [stored, token, name, pending] = await Promise.all([
          read(keys.session),
          read(keys.device),
          read(keys.name),
          read(keys.pending),
        ]);
        if (!mounted) return;
        tokenRef.current = token;
        if (pending) {
          try {
            await request<DeviceContext>("device", { device: pending });
            await write(keys.device, pending);
            await remove(keys.pending);
            tokenRef.current = pending;
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 401))
              throw cause;
          }
        }
        if (name) setDeviceName(name);
        else {
          const value = `VHH-TAB-${Crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await write(keys.name, value);
          if (mounted) setDeviceName(value);
        }
        if (stored) {
          const s = JSON.parse(stored) as Session;
          if (!s.sessionToken || !["driver", "setup"].includes(s.mode))
            throw new Error("Please sign in again.");
          sessionRef.current = s;
          setSession(s);
        }
        await refresh();
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
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
      else if (state === "background") {
        setDriver(null);
      }
    });
    return () => {
      mounted = false;
      invalidateRequests();
      subscription.remove();
    };
  }, [refresh]);
  async function login(identifier: string, password: string) {
    const s = await request<Session>("auth/login", {
      method: "POST",
      body: { identifier, password },
    });
    try {
      await stopTracking("account_changed");
      await write(keys.session, JSON.stringify(s));
    } catch (cause) {
      await request("auth/session", {
        method: "DELETE",
        session: s.sessionToken,
      }).catch(() => undefined);
      throw cause;
    }
    generation.current++;
    sessionRef.current = s;
    setSession(s);
    setDriver(null);
    setError("");
    const assigned = await refresh();
    const active = sessionRef.current;
    if (!active) throw new Error("Please sign in again.");
    return active.mode === "setup"
      ? assigned?.truck
        ? ("/setup/ready" as const)
        : ("/setup" as const)
      : ("/truck" as const);
  }
  async function logout() {
    const s = sessionRef.current;
    await stopTracking("signed_out");
    // Keep the token available for a retry if server revocation is unavailable.
    if (s)
      await request("auth/session", {
        method: "DELETE",
        session: s.sessionToken,
      });
    await remove(keys.session);
    generation.current++;
    sessionRef.current = null;
    setSession(null);
    setDriver(null);
    setSelection(null);
    setError("");
  }
  async function enroll(
    truck: Truck,
    identifier: string,
    replaceExisting: boolean,
  ) {
    const s = sessionRef.current;
    if (!s || s.mode !== "setup")
      throw new Error("Sign in as a fleet administrator.");
    await stopTracking("device_setup");
    const pending = await read(keys.pending),
      token =
        pending ??
        Array.from(await Crypto.getRandomBytesAsync(32), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
    await write(keys.pending, token);
    let recovered: DeviceContext | null = null;
    if (pending) {
      try {
        const existing = await request<DeviceContext>("device", {
          device: token,
        });
        if (
          existing.truck?.id === truck.id &&
          existing.device.identifier === identifier.trim().toUpperCase()
        )
          recovered = existing;
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 401)) throw cause;
      }
    }
    const next =
      recovered ??
      (await request<DeviceContext>("setup/device", {
        method: "POST",
        session: s.sessionToken,
        body: {
          truckId: truck.id,
          deviceIdentifier: identifier,
          deviceToken: token,
          expectedDeviceId: truck.device?.id ?? null,
          replaceExisting,
        },
      }));
    // The pending key makes a successful-but-interrupted enrollment recoverable on restart.
    await write(keys.device, token);
    await write(keys.name, identifier.trim().toUpperCase());
    await remove(keys.pending);
    tokenRef.current = token;
    generation.current++;
    setDevice(next);
    setDeviceName(identifier.trim().toUpperCase());
    setDriver(null);
    setError("");
  }
  async function confirm() {
    const s = sessionRef.current,
      token = tokenRef.current;
    if (!s || !token || !driver?.associationId)
      throw new Error("Refresh the assigned truck and try again.");
    const result = await request<DeviceContext & { confirmedAt: string }>(
      "driver/truck/confirm",
      {
        method: "POST",
        session: s.sessionToken,
        device: token,
        body: { associationId: driver.associationId },
      },
    );
    setDevice(result);
    setDriver({ ...driver, ...result });
    setError("");
  }
  return (
    <Context.Provider
      value={{
        ready,
        session,
        device,
        driver,
        error,
        deviceName,
        selection,
        selectTruck: (truck, identifier) => setSelection({ truck, identifier }),
        refresh,
        login,
        logout,
        enroll,
        confirm,
        clearError: () => setError(""),
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
