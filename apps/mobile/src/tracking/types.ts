export interface LocalStream {
  id: string;
  device_id: string;
  driver_id: string;
  truck_id: string;
  association_id: string;
  started_at: number;
  stopped_at: number | null;
  next_sequence: number;
  end_reported: number;
}
export interface TrackingEvent {
  eventId: string;
  sequence: number;
  kind: "location" | "status";
  recordedAt: string;
  data: Record<string, unknown>;
}
export interface Batch {
  batchId: string;
  streamId: string;
  events: TrackingEvent[];
  end?: { at: string; finalSequence: number };
}
export interface Receipt {
  batchId: string;
  streamId: string;
  acceptedIds: string[];
  rejected: { eventId: string; reason: string }[];
  captureAllowed: boolean;
  closed: boolean;
  receivedAt: string;
}
export interface TrackingStatus {
  collecting: boolean;
  active: LocalStream | null;
  pending: number;
  blocked: number;
  lastFixAt: number | null;
  lastSyncAt: number | null;
  error: string;
  transport: string;
}
export const emptyStatus: TrackingStatus = {
  collecting: false,
  active: null,
  pending: 0,
  blocked: 0,
  lastFixAt: null,
  lastSyncAt: null,
  error: "",
  transport: "Disconnected",
};
