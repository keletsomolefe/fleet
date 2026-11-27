import type { Sql } from "../tracking/queue";

export type Ref = { id: string | null; name: string };

export type ActivityKind = "collection" | "delivery" | "fuel" | "expense";
export type RoadExpenseCategory =
  | "toll"
  | "repair"
  | "tyres"
  | "weighbridge"
  | "parking"
  | "permits"
  | "other";

export type Data = {
  kind: ActivityKind;
  occurredAt: string;
  arrivedAt: string | null;
  departedAt: string | null;
  dispatchId: string | null;
  runId: string | null;
  customer: Ref;
  product: Ref;
  supplier: Ref;
  receiver: Ref;
  origin: Ref;
  destination: Ref;
  quantity: string | null;
  collectedQuantity: string | null;
  grossWeight: string | null;
  tareWeight: string | null;
  waybillNumber: string;
  unit: string;
  allocations: { deliveryId: string; quantity: string }[];
  fuelLitres: string | null;
  fuelTotalCost: string | null;
  fuelStation: string;
  expenseCategory: RoadExpenseCategory | null;
  expenseAmount: string | null;
  vendorName: string;
  receiptNumber: string;
  odometerKm: string | null;
  transportCharge: boolean;
  outcome: string;
  note: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
};

export type Context = {
  id: string;
  driverId: string;
  truckId: string;
  drivingSessionId: string;
  confirmedDate: string;
};

export type Event = {
  id: string;
  recordId: string;
  baseVersion: number;
  data: Data;
};

export type LocalRecord = {
  id: string;
  context_id: string;
  data: string;
  version: number;
  review: string;
  acknowledged_at: number | null;
  blocked_reason: string | null;
};

export type QueuedAttachment = {
  id: string;
  owner_type: "record" | "shift";
  owner_id: string;
  context_id: string | null;
  kind: string;
  local_uri: string;
  mime_type: string;
  created_at: number;
  uploaded_at: number | null;
  error: string | null;
  attempts: number;
  retry_after: number;
};

export type Receipt = {
  accepted: {
    id: string;
    recordId: string;
    version: number;
    conflict: boolean;
  }[];
  rejected: { id: string; reason: string }[];
  stopCapture: boolean;
  receivedAt: string;
};

export const schema = `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS activity_contexts(id TEXT PRIMARY KEY, driver_id TEXT NOT NULL, payload TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS activity_events(id TEXT PRIMARY KEY, record_id TEXT NOT NULL, context_id TEXT NOT NULL REFERENCES activity_contexts(id), base_version INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER, blocked_reason TEXT, retry_after INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_activity_pending ON activity_events(acknowledged_at,blocked_reason,retry_after,created_at);
CREATE TABLE IF NOT EXISTS activity_records(id TEXT PRIMARY KEY, context_id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, review TEXT NOT NULL DEFAULT 'pending', event_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity_attachments(id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, context_id TEXT, kind TEXT NOT NULL, local_uri TEXT NOT NULL, mime_type TEXT NOT NULL, created_at INTEGER NOT NULL, uploaded_at INTEGER, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_after INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_activity_attachments_pending ON activity_attachments(uploaded_at,retry_after,created_at);
CREATE TABLE IF NOT EXISTS activity_cache(key TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity_drafts(key TEXT PRIMARY KEY, payload TEXT NOT NULL);`;

export function activityQueue(db: Sql, newId: () => string, now = Date.now) {
  async function cache(key: string, payload: unknown) {
    await db.run(
      "INSERT INTO activity_cache(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
      key,
      JSON.stringify(payload),
    );
  }

  async function cached<T>(key: string): Promise<T | null> {
    const row = await db.first<{ payload: string }>(
      "SELECT payload FROM activity_cache WHERE key=?",
      key,
    );
    return row ? (JSON.parse(row.payload) as T) : null;
  }

  async function saveDraft(key: string, payload: unknown | null) {
    if (payload == null) {
      await db.run("DELETE FROM activity_drafts WHERE key=?", key);
      return;
    }
    await db.run(
      "INSERT INTO activity_drafts(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
      key,
      JSON.stringify(payload),
    );
  }

  async function loadDraft<T>(key: string): Promise<T | null> {
    const row = await db.first<{ payload: string }>(
      "SELECT payload FROM activity_drafts WHERE key=?",
      key,
    );
    return row ? (JSON.parse(row.payload) as T) : null;
  }

  async function active(): Promise<Context | null> {
    const row = await db.first<{ payload: string }>(
      "SELECT payload FROM activity_contexts WHERE active=1 LIMIT 1",
    );
    return row ? (JSON.parse(row.payload) as Context) : null;
  }

  async function context(value: Context) {
    await db.transaction(async (tx) => {
      await tx.run("UPDATE activity_contexts SET active=0");
      await tx.run(
        "INSERT INTO activity_contexts(id,driver_id,payload,active) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, active=1",
        value.id,
        value.driverId,
        JSON.stringify(value),
      );
    });
  }

  async function stop() {
    await db.run("UPDATE activity_contexts SET active=0");
  }

  async function append(contextId: string, recordId: string, data: Data) {
    return db.transaction(async (tx) => {
      const valid = await tx.first(
        "SELECT c.id FROM activity_contexts c JOIN activity_contexts current ON current.active=1 AND current.driver_id=c.driver_id WHERE c.id=?",
        contextId,
      );
      if (!valid) {
        throw new Error("Confirm your vehicle online before recording.");
      }
      const old = await tx.first<{ version: number; context_id: string }>(
        "SELECT version,context_id FROM activity_records WHERE id=?",
        recordId,
      );
      if (old && old.context_id !== contextId) {
        throw new Error("This entry belongs to an earlier recording session.");
      }
      const event: Event = {
        id: newId(),
        recordId,
        baseVersion: old?.version ?? 0,
        data,
      };
      const ts = now();
      await tx.run(
        "INSERT INTO activity_events(id,record_id,context_id,base_version,payload,created_at) VALUES(?,?,?,?,?,?)",
        event.id,
        recordId,
        contextId,
        event.baseVersion,
        JSON.stringify(event),
        ts,
      );
      await tx.run(
        "INSERT INTO activity_records(id,context_id,data,version,review,event_id) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, event_id=excluded.event_id",
        recordId,
        contextId,
        JSON.stringify(data),
        old?.version ?? 0,
        "pending",
        event.id,
      );
      return event;
    });
  }

  async function queueAttachment(item: {
    ownerType: "record" | "shift";
    ownerId: string;
    contextId: string | null;
    kind: string;
    localUri: string;
    mimeType: string;
  }) {
    const id = newId();
    await db.run(
      "INSERT INTO activity_attachments(id,owner_type,owner_id,context_id,kind,local_uri,mime_type,created_at) VALUES(?,?,?,?,?,?,?,?)",
      id,
      item.ownerType,
      item.ownerId,
      item.contextId,
      item.kind,
      item.localUri,
      item.mimeType,
      now(),
    );
    return id;
  }

  async function pendingBatch(force = false) {
    const cutoff = force ? Number.MAX_SAFE_INTEGER : now();
    const first = await db.first<{ context_id: string }>(
      "SELECT context_id FROM activity_events WHERE acknowledged_at IS NULL AND blocked_reason IS NULL AND retry_after<=? ORDER BY created_at ASC LIMIT 1",
      cutoff,
    );
    if (!first) return null;
    const rows = await db.all<{ payload: string }>(
      "SELECT payload FROM activity_events WHERE context_id=? AND acknowledged_at IS NULL AND blocked_reason IS NULL AND retry_after<=? ORDER BY created_at ASC LIMIT 25",
      first.context_id,
      cutoff,
    );
    return {
      contextId: first.context_id,
      events: rows.map((r) => JSON.parse(r.payload) as Event),
    };
  }

  async function pendingAttachments(force = false) {
    const cutoff = force ? Number.MAX_SAFE_INTEGER : now();
    return db.all<QueuedAttachment>(
      `SELECT a.* FROM activity_attachments a
       LEFT JOIN activity_records r ON a.owner_type='record' AND r.id=a.owner_id
       WHERE a.uploaded_at IS NULL AND a.retry_after<=?
         AND (a.owner_type='shift' OR (r.version IS NOT NULL AND r.version > 0))
       ORDER BY a.created_at ASC LIMIT 10`,
      cutoff,
    );
  }

  async function markAttachmentUploaded(id: string) {
    await db.run(
      "UPDATE activity_attachments SET uploaded_at=?, error=NULL WHERE id=?",
      now(),
      id,
    );
  }

  async function markAttachmentFailed(id: string, reason: string, permanent = false) {
    const row = await db.first<{ attempts: number }>(
      "SELECT attempts FROM activity_attachments WHERE id=?",
      id,
    );
    const attempts = (row?.attempts ?? 0) + 1;
    const delay = permanent
      ? 24 * 60 * 60 * 1000
      : Math.min(300_000, 5_000 * 2 ** Math.min(attempts, 6));
    await db.run(
      "UPDATE activity_attachments SET attempts=?, error=?, retry_after=? WHERE id=?",
      attempts,
      reason,
      now() + delay,
      id,
    );
  }

  async function applyReceipt(receipt: Receipt) {
    await db.transaction(async (tx) => {
      const ts = now();
      for (const acc of receipt.accepted) {
        await tx.run(
          "UPDATE activity_events SET acknowledged_at=?, blocked_reason=NULL WHERE id=?",
          ts,
          acc.id,
        );
        await tx.run(
          "UPDATE activity_records SET version=? WHERE id=? AND version<?",
          acc.version,
          acc.recordId,
          acc.version,
        );
      }
      for (const rej of receipt.rejected) {
        await tx.run(
          "UPDATE activity_events SET blocked_reason=? WHERE id=?",
          rej.reason,
          rej.id,
        );
      }
      if (receipt.stopCapture) {
        await tx.run("UPDATE activity_contexts SET active=0");
      }
    });
  }

  async function backoffEvents(eventIds: string[]) {
    if (!eventIds.length) return;
    await db.transaction(async (tx) => {
      for (const id of eventIds) {
        const row = await tx.first<{ attempts: number }>(
          "SELECT attempts FROM activity_events WHERE id=?",
          id,
        );
        const attempts = (row?.attempts ?? 0) + 1;
        const delay = Math.min(300_000, 5_000 * 2 ** Math.min(attempts, 6));
        await tx.run(
          "UPDATE activity_events SET attempts=?, retry_after=? WHERE id=?",
          attempts,
          now() + delay,
          id,
        );
      }
    });
  }

  async function reviews(
    items: { id: string; version: number; review: string }[],
  ) {
    if (!items.length) return;
    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx.run(
          "UPDATE activity_records SET review=?, version=MAX(version, ?) WHERE id=?",
          item.review,
          item.version,
          item.id,
        );
      }
    });
  }

  async function records(driverId: string): Promise<LocalRecord[]> {
    return db.all<LocalRecord>(
      `SELECT r.id, r.context_id, r.data, r.version, r.review, e.acknowledged_at, e.blocked_reason
       FROM activity_records r
       JOIN activity_contexts c ON c.id = r.context_id
       LEFT JOIN activity_events e ON e.id = r.event_id
       WHERE c.driver_id = ?
       ORDER BY COALESCE(e.created_at, 0) DESC
       LIMIT 100`,
      driverId,
    );
  }

  async function counts() {
    const ev = await db.first<{ pending: number; blocked: number }>(
      "SELECT COUNT(*) FILTER (WHERE acknowledged_at IS NULL AND blocked_reason IS NULL) AS pending, COUNT(*) FILTER (WHERE acknowledged_at IS NULL AND blocked_reason IS NOT NULL) AS blocked FROM activity_events",
    );
    const att = await db.first<{ pendingPhotos: number }>(
      "SELECT COUNT(*) AS pendingPhotos FROM activity_attachments WHERE uploaded_at IS NULL",
    );
    return {
      pending: (ev?.pending ?? 0) + (att?.pendingPhotos ?? 0),
      blocked: ev?.blocked ?? 0,
      pendingPhotos: att?.pendingPhotos ?? 0,
    };
  }

  return {
    cache,
    cached,
    saveDraft,
    loadDraft,
    active,
    context,
    stop,
    append,
    queueAttachment,
    pendingBatch,
    pendingAttachments,
    markAttachmentUploaded,
    markAttachmentFailed,
    applyReceipt,
    backoffEvents,
    reviews,
    records,
    counts,
  };
}
