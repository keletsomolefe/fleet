import Constants from "expo-constants";
import { Platform } from "react-native";

export type Mode = "driver" | "admin";
export interface Account {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
export interface Session {
  sessionToken: string;
  mode: Mode;
  permissions: string[];
  user: Account;
  expiresAt: string | null;
}
export interface Truck {
  id: string;
  identifier: string;
  registration: string;
  make: string;
  model: string;
  status?: string;
  activeSession?: {
    id: string;
    driverId: string;
    driverName: string;
    startedAt: string;
  } | null;
  disputed?: boolean;
  scheduled?: boolean;
}
export interface DriverContext {
  date: string;
  schedule: { id: string; date: string; truck: Truck } | null;
  pendingDispute: { id: string; note: string | null } | null;
  driver: { id: string; identifier: string; name: string };
  truck: Truck | null;
  drivingSession: {
    id: string;
    startedAt: string;
    onThisPhone: boolean;
  } | null;
  canDrive: boolean;
  reason: string | null;
  confirmedAt: string | null;
}
export interface TruckList {
  items: Truck[];
  total: number;
  page: number;
  pageSize: number;
}
export interface VehicleDispute {
  kind: "occupancy" | "schedule";
  requestedScheduleId: string | null;
  requestedScheduledDriver: string | null;
  scheduleDate: string | null;
  driverNote: string | null;
  requestedTruck: Truck | null;
  schedule: { id: string; truckId: string } | null;
  requestedTruckSession: { id: string; driverName: string } | null;
  id: string;
  truck: Truck;
  requestedBy: string;
  currentDriver: { id: string; driverName: string; startedAt: string } | null;
  createdAt: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
const configured = Constants.expoConfig?.extra?.apiUrl as
  string | null | undefined;
const apiUrl = (
  typeof configured === "string" ? configured : "http://127.0.0.1:3042/api"
).replace(/\/$/, "");
export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    session?: string;
    device?: string;
    recording?: string;
  } = {},
): Promise<T> {
  // The web target is a visual preview. Native session credentials never enter browser storage.
  if (Platform.OS === "web")
    throw new ApiError(400, "Open the installed Fleet app to continue.");
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/mobile/${path}`, {
      method: options.method ?? "GET",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.session
          ? { Authorization: `Bearer ${options.session}` }
          : {}),
        ...(options.device ? { "X-Fleet-Device-Token": options.device } : {}),
        ...(options.recording ? { "X-Fleet-Recording-Token": options.recording } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      0,
      "Could not connect. Check your connection and try again.",
    );
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof body?.message === "string"
        ? body.message
        : "Could not complete the request. Please try again.",
      body && typeof body === "object" ? body : undefined,
    );
  return body as T;
}
