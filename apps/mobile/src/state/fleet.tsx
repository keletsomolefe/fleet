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

type FleetState = {
  ready: boolean;
  session: Session | null;
  device: DeviceContext | null;
  driver: DriverContext | null;
  error: string;
  deviceName: string;
  selection: { truck: Truck; identifier: string } | null;
  selectTruck: (truck: Truck, identifier: string) => void;
  refresh: () => Promise<void>;
  login: (identifier: string, password: string, mode: Mode) => Promise<void>;
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
      current = sessionRef.current,
      token = tokenRef.current;
    try {
      let next: DeviceContext | null = null;
      if (token)
        next = await request<DeviceContext>("device", { device: token });
      if (ticket !== generation.current) return;
      setDevice(next);
      if (current) {
        const access = await request<{ permissions: string[] }>(
          "auth/session",
          { session: current.sessionToken },
        );
        const required =
          current.mode === "driver"
            ? ["driver.access"]
            : ["admin.access", "trucks.read", "trucks.write"];
        if (required.some((p) => !access.permissions.includes(p))) {
          await remove(keys.session);
          sessionRef.current = null;
          setSession(null);
          throw new ApiError(403, "Your access changed. Please sign in again.");
        }
        if (current.mode === "driver" && token) {
          let profile: DriverContext;
          try {
            profile = await request<DriverContext>("driver/truck", {
              session: current.sessionToken,
              device: token,
            });
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 403) {
              await remove(keys.session);
              sessionRef.current = null;
              setSession(null);
            }
            throw cause;
          }
          if (ticket === generation.current) setDriver(profile);
        }
      }
      if (ticket === generation.current) setError("");
    } catch (cause) {
      if (ticket !== generation.current) return;
      setDriver(null);
      setDevice(null);
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
        // Validate the account independently so revoked device credentials do not destroy a valid login.
        if (current) {
          try {
            await request("auth/session", { session: current.sessionToken });
          } catch (sessionError) {
            if (
              sessionError instanceof ApiError &&
              [401, 403].includes(sessionError.status)
            ) {
              await remove(keys.session);
              sessionRef.current = null;
              setSession(null);
            }
          }
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh this device.",
      );
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
  async function login(identifier: string, password: string, mode: Mode) {
    const s = await request<Session>("auth/login", {
      method: "POST",
      body: { identifier, password, mode },
    });
    try {
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
    await refresh();
  }
  async function logout() {
    const s = sessionRef.current;
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
