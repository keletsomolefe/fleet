import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseHeader,
} from "@tanstack/react-start/server";
export type Json =
  | null
  | undefined
  | string
  | number
  | boolean
  | Json[]
  | { [key: string]: Json };
export type Entry = {
  id: string;
  name: string;
  active: boolean;
  version: number;
  [key: string]: Json;
};
export type Ref = { id: string | null; name: string };
export type ActivityData = {
  kind: string;
  occurredAt: string;
  customer: Ref;
  product: Ref;
  origin: Ref;
  destination: Ref;
  supplier: Ref;
  receiver: Ref;
  quantity: string | null;
  unit: string;
  collectedQuantity: string | null;
  fuelLitres: string | null;
  fuelTotalCost: string | null;
  outcome: string;
  note: string;
  transportCharge: boolean;
  allocations: { deliveryId: string; quantity: string }[];
  [key: string]: Json;
};
export type RecordRow = {
  id: string;
  kind: string;
  occurredAt: string;
  review: string;
  flags: string[];
  data: ActivityData;
  version: number;
  amount?: string;
  pricingStatus?: string;
  registration: string;
  driverName: string;
  [key: string]: Json;
};
export type Job = {
  allocationConflict?: boolean;
  id: string;
  reference: string;
  date: string;
  driverId: string;
  truckId: string;
  status: string;
  version: number;
  plan: {
    customer: Ref;
    product: Ref;
    supplier: Ref;
    origin: Ref;
    quantity: string;
    unit: string;
    instructions: string;
    collectionId: string;
    deliveries: {
      id: string;
      destination: Ref;
      receiver: Ref;
      quantity: string;
      collectedQuantity: string | null;
    }[];
  };
};
export type Catalogue = {
  trucks?: Entry[];
  customers: Entry[];
  locations: Entry[];
  products: Entry[];
  customerProducts: Entry[];
  units: string[];
};
export type TransportPageData = {
  catalogue: Catalogue;
  rates?: Entry[];
  jobs?: {
    items: Job[];
    drivers: Entry[];
    trucks: (Entry & { identifier: string; registration: string })[];
  };
  records?: RecordRow[];
  error?: string;
};
export const sections = [
  "customers",
  "locations",
  "products",
  "pricing",
  "dispatch",
  "activities",
  "earnings",
];
export const getTransportPage = createServerFn({ method: "GET" })
  .validator((section: string) => {
    if (!sections.includes(section)) throw new Error("Unknown page.");
    return section;
  })
  .handler(async ({ data }): Promise<TransportPageData> => {
    setResponseHeader("Cache-Control", "private, no-store");
    const empty: Catalogue = {
      customers: [],
      locations: [],
      products: [],
      customerProducts: [],
      units: [],
    };
    try {
      const read = async <T>(path: string): Promise<T> => {
        const response = await fetch(
          new URL(`api/admin/transport/${path}`, process.env.APP_URL),
          {
            headers: { Cookie: getRequestHeader("cookie") ?? "" },
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "You do not have access to this page."
              : "Could not load this page. Please try again.",
          );
        return response.json() as Promise<T>;
      };
      const catalogue = await read<Catalogue>("catalogue");
      return {
        catalogue,
        ...(data === "pricing" ? { rates: await read<Entry[]>("rates") } : {}),
        ...(data === "dispatch"
          ? {
              jobs: await read<NonNullable<TransportPageData["jobs"]>>(
                "dispatches",
              ),
            }
          : {}),
        ...(data === "activities"
          ? { records: await read<RecordRow[]>("records") }
          : {}),
      };
    } catch (e) {
      return {
        catalogue: empty,
        error: e instanceof Error ? e.message : "Could not load this page.",
      };
    }
  });
export async function transportRequest<T>(
  path: string,
  csrfToken: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api/admin/transport/${path}`, {
    method: body == null ? "GET" : method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message ?? "Could not save. Please try again.");
  return result as T;
}
