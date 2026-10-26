import type { Sql } from "../tracking/queue";
export type Data = {
  kind: "collection" | "delivery" | "fuel";
  occurredAt: string;
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
  unit: string;
  allocations: { deliveryId: string; quantity: string }[];
  fuelLitres: string | null;
  fuelTotalCost: string | null;
  odometerKm: string | null;
  transportCharge: boolean;
  outcome: string;
  note: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
};
export type Ref = { id: string | null; name: string };
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
        "INSERT INTO activity_contexts(id,driver_id,payload,active) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET active=1",
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
      if (!valid)
        throw new Error("Confirm your vehicle online before recording.");
      const old = await tx.first<{ version: number; context_id: string }>(
        "SELECT version,context_id FROM activity_records WHERE id=?",
        recordId,
      );
      if (old && old.context_id !== contextId)
        throw new Error("This entry belongs to an earlier recording session.");
      const event: Event = {
        id: newId(),
        recordId,
        baseVersion: old?.version ?? 0,
        data,
      };
      await tx.run(
        "INSERT INTO activity_events(id,record_id,context_id,base_version,payload,created_at) VALUES(?,?,?,?,?,?)",
        event.id,
        recordId,
        contextId,
        event.baseVersion,
        JSON.stringify(event),
        now(),
      );
      await tx.run(
        "INSERT INTO activity_records(id,context_id,data,version,review,event_id) VALUES(?,?,?,?,'pending',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,review='pending',event_id=excluded.event_id",
        recordId,
        contextId,
        JSON.stringify(data),
        event.baseVersion + 1,
        event.id,
      );
      return event;
    });
  }
  async function batch(force = false) {
    const rows = await db.all<{
      id: string;
      context_id: string;
      payload: string;
    }>(
      `SELECT e.id,e.context_id,e.payload FROM activity_events e WHERE e.acknowledged_at IS NULL AND e.blocked_reason IS NULL AND (?=1 OR e.retry_after<=?) AND NOT EXISTS(SELECT 1 FROM activity_events prior WHERE prior.record_id=e.record_id AND prior.base_version<e.base_version AND prior.acknowledged_at IS NULL) ORDER BY e.created_at,e.rowid LIMIT 30`,
      force ? 1 : 0,
      now(),
    );
    if (!rows.length) return null;
    const contextId = rows[0].context_id;
    let bytes = 0;
    const events: Event[] = [];
    for (const row of rows) {
      if (row.context_id !== contextId) continue;
      const size = row.payload.length * 3;
      if (events.length && bytes + size > 80000) break;
      events.push(JSON.parse(row.payload) as Event);
      bytes += size;
    }
    return { contextId, events };
  }
  async function receipt(
    sent: { contextId: string; events: Event[] },
    r: Receipt,
  ) {
    const ids = new Set(sent.events.map((e) => e.id));
    const covered = [
      ...(r.accepted ?? []).map((e) => e.id),
      ...(r.rejected ?? []).map((e) => e.id),
    ];
    if (
      covered.length !== ids.size ||
      new Set(covered).size !== ids.size ||
      covered.some((x) => !ids.has(x)) ||
      r.accepted.some(
        (a) =>
          !Number.isSafeInteger(a.version) ||
          a.version < 1 ||
          sent.events.find((e) => e.id === a.id)?.recordId !== a.recordId,
      )
    )
      throw new Error("The server did not confirm these saved records.");
    await db.transaction(async (tx) => {
      for (const a of r.accepted) {
        await tx.run(
          "UPDATE activity_events SET acknowledged_at=? WHERE id=? AND context_id=?",
          now(),
          a.id,
          sent.contextId,
        );
        await tx.run(
          "UPDATE activity_records SET version=MAX(version,?),review=? WHERE event_id=?",
          a.version,
          a.conflict ? "pending" : "pending",
          a.id,
        );
      }
      for (const e of r.rejected)
        await tx.run(
          "UPDATE activity_events SET blocked_reason=? WHERE id=? AND context_id=?",
          e.reason.slice(0, 500),
          e.id,
          sent.contextId,
        );
      await tx.run(
        "INSERT INTO activity_cache(key,payload) VALUES('lastSync',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
        JSON.stringify(now()),
      );
    });
  }
  async function failed(sent: { events: Event[] }, message: string) {
    await db.transaction(async (tx) => {
      for (const e of sent.events) {
        const row = await tx.first<{ attempts: number }>(
          "SELECT attempts FROM activity_events WHERE id=?",
          e.id,
        );
        const attempts = (row?.attempts ?? 0) + 1;
        await tx.run(
          "UPDATE activity_events SET attempts=?,retry_after=? WHERE id=? AND acknowledged_at IS NULL",
          attempts,
          now() + Math.min(300000, 1000 * 2 ** Math.min(attempts, 9)),
          e.id,
        );
      }
    });
    await cache("error", message);
  }
  async function records(driverId: string) {
    return db.all<LocalRecord>(
      "SELECT r.*,e.acknowledged_at,e.blocked_reason FROM activity_records r JOIN activity_contexts c ON c.id=r.context_id JOIN activity_events e ON e.id=r.event_id WHERE c.driver_id=? ORDER BY e.created_at DESC LIMIT 200",
      driverId,
    );
  }
  async function status() {
    const row = await db.first<{ pending: number; blocked: number }>(
      `SELECT count(*) FILTER(WHERE acknowledged_at IS NULL AND blocked_reason IS NULL) AS pending,count(*) FILTER(WHERE blocked_reason IS NOT NULL) AS blocked FROM activity_events`,
    );
    return {
      ...row,
      lastSync: await cached<number>("lastSync"),
      error: await cached<string>("error"),
      syncing: ((await cached<number>("syncingAt")) ?? 0) > now() - 90000,
    };
  }
  async function draft(key: string, value?: unknown) {
    if (value === undefined) {
      const r = await db.first<{ payload: string }>(
        "SELECT payload FROM activity_drafts WHERE key=?",
        key,
      );
      return r
        ? (JSON.parse(r.payload) as { recordId: string; data: Data })
        : null;
    }
    await db.run(
      "INSERT INTO activity_drafts(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
      key,
      JSON.stringify(value),
    );
    return null;
  }
  async function clearDraft(key: string) {
    await db.run("DELETE FROM activity_drafts WHERE key=?", key);
  }
  async function reviews(
    rows: { id: string; version: number; review: string }[],
  ) {
    await db.transaction(async (tx) => {
      for (const r of rows)
        await tx.run(
          "UPDATE activity_records SET version=MAX(version,?),review=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM activity_events e WHERE e.record_id=? AND e.acknowledged_at IS NULL)",
          r.version,
          r.review,
          r.id,
          r.id,
        );
    });
  }
  async function retry(recordId: string) {
    await db.run(
      "UPDATE activity_events SET blocked_reason=NULL,retry_after=0 WHERE record_id=? AND acknowledged_at IS NULL",
      recordId,
    );
  }
  return {
    cache,
    cached,
    active,
    context,
    stop,
    append,
    batch,
    receipt,
    failed,
    records,
    status,
    draft,
    clearDraft,
    reviews,
    retry,
  };
}
