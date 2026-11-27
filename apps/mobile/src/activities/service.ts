import type { DriverContext, Session } from "../lib/api";
import type { CapturedPhoto } from "../lib/photos";
import type { Data } from "./queue";

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

export async function prepareRecording(
  _session: Session,
  _driver: DriverContext,
  _isCurrent?: () => boolean,
) {}

export async function refreshActivities(_session: Session, _driverId: string) {}

export async function saveActivity(
  _contextId: string,
  _recordId: string,
  _data: Data,
  _photo?: { file: CapturedPhoto; kind: string } | null,
) {
  throw new Error("Offline activity recording is available in the mobile app.");
}

export async function queueShiftPhoto(
  _sessionId: string,
  _photo: CapturedPhoto,
  _kind: "start_odometer_photo" | "end_odometer_photo",
) {}

export async function stopRecording() {}

export async function syncActivities(_force = false) {}

export async function getActivitySyncStatus() {
  return {
    pending: 0,
    blocked: 0,
    pendingPhotos: 0,
    syncing: false,
    lastSync: null as number | null,
    error: null as string | null,
  };
}
