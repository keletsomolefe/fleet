import Constants from "expo-constants";
import { Platform } from "react-native";

export type Mode = "driver" | "setup";
export interface Account {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
export interface Session {
  sessionToken: string;
  mode: Mode;
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
  device?: { id: string; identifier: string; enrolled: boolean } | null;
}
export interface DeviceContext {
  device: { id: string; identifier: string };
  truck: Truck | null;
  associationId: string | null;
}
export interface DriverContext extends DeviceContext {
  driver: { id: string; identifier: string; name: string };
  canConfirm: boolean;
  reason: string | null;
  confirmedAt: string | null;
}
export interface TruckList {
  items: Truck[];
  total: number;
  page: number;
  pageSize: number;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      0,
      "Could not reach operations. Check your connection and try again.",
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
    );
  return body as T;
}
