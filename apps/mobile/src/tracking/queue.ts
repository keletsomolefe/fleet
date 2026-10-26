import type {
  Batch,
  LocalStream,
  Receipt,
  TrackingEvent,
  TrackingStatus,
} from "./types";
export interface Sql {
  exec(sql: string): Promise<void>;
  run(sql: string, ...args: (string | number | null)[]): Promise<void>;
  first<T>(sql: string, ...args: (string | number | null)[]): Promise<T | null>;
  all<T>(sql: string, ...args: (string | number | null)[]): Promise<T[]>;
  transaction<T>(action: (db: Sql) => Promise<T>): Promise<T>;
}
export const schema = `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS tracking_streams (id TEXT PRIMARY KEY,device_id TEXT NOT NULL,driver_id TEXT NOT NULL,truck_id TEXT NOT NULL,association_id TEXT NOT NULL,driving_session_id TEXT,started_at INTEGER NOT NULL,stopped_at INTEGER,next_sequence INTEGER NOT NULL DEFAULT 1,end_reported INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tracking_events (event_id TEXT PRIMARY KEY,stream_id TEXT NOT NULL REFERENCES tracking_streams(id),sequence INTEGER NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,acknowledged_at INTEGER,blocked_reason TEXT,retry_after INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(stream_id,sequence));
CREATE INDEX IF NOT EXISTS idx_tracking_pending ON tracking_events (acknowledged_at,blocked_reason,retry_after,created_at);
CREATE TABLE IF NOT EXISTS tracking_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tracking_unattributed (id TEXT PRIMARY KEY,recorded_at INTEGER,raw TEXT NOT NULL,reason TEXT NOT NULL);`;
export function queue(db: Sql, newId: () => string, now = Date.now) {
  async function meta(key: string, value: string) {
    await db.run(
      "INSERT INTO tracking_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      value,
    );
  }
  async function active() {
    return db.first<LocalStream>(
      "SELECT * FROM tracking_streams WHERE stopped_at IS NULL ORDER BY started_at DESC LIMIT 1",
    );
  }
  async function append(
    tx: Sql,
    stream: LocalStream,
    kind: TrackingEvent["kind"],
    at: number,
    data: Record<string, unknown>,
  ) {
    const current = await tx.first<LocalStream>(
      "SELECT * FROM tracking_streams WHERE id=?",
      stream.id,
    );
    if (!current) throw new Error("Tracking session is missing.");
    const event: TrackingEvent = {
      eventId: newId(),
      sequence: current.next_sequence,
      kind,
      recordedAt: new Date(at).toISOString(),
      data,
    };
    await tx.run(
      "INSERT INTO tracking_events (event_id,stream_id,sequence,payload,created_at) VALUES (?,?,?,?,?)",
      event.eventId,
      stream.id,
      event.sequence,
      JSON.stringify(event),
      now(),
    );
    await tx.run(
      "UPDATE tracking_streams SET next_sequence=next_sequence+1,end_reported=0 WHERE id=?",
      stream.id,
    );
    return event;
  }
  async function addStream(
    stream: Omit<LocalStream, "next_sequence" | "end_reported" | "stopped_at">,
  ) {
    await db.transaction(async (tx) => {
      const current = await tx.first<LocalStream>(
        "SELECT * FROM tracking_streams WHERE stopped_at IS NULL",
      );
      if (current && current.id !== stream.id)
        throw new Error("Stop the current location sharing session first.");
      await tx.run(
        "INSERT OR IGNORE INTO tracking_streams (id,device_id,driver_id,truck_id,association_id,started_at,driving_session_id) VALUES (?,?,?,?,?,?,?)",
        stream.id,
        stream.device_id,
        stream.driver_id,
        stream.truck_id,
        stream.association_id,
        stream.started_at,
        stream.driving_session_id ?? null,
      );
    });
  }
  async function statusEvent(
    code: string,
    detail: Record<string, unknown> = {},
  ) {
    return db.transaction(async (tx) => {
      const stream = await tx.first<LocalStream>(
        "SELECT * FROM tracking_streams WHERE stopped_at IS NULL ORDER BY started_at DESC LIMIT 1",
      );
      if (stream)
        await append(tx, stream, "status", now(), { code, ...detail });
    });
  }
  async function locations(
    locations: {
      timestamp: number;
      coords: Record<string, unknown>;
      [key: string]: unknown;
    }[],
  ) {
    await db.transaction(async (tx) => {
      for (const location of locations) {
        const stream = await tx.first<LocalStream>(
          "SELECT * FROM tracking_streams WHERE started_at<=? AND (stopped_at IS NULL OR stopped_at>=?) ORDER BY started_at DESC LIMIT 1",
          location.timestamp,
          location.timestamp,
        );
        if (!stream || !Number.isFinite(location.timestamp)) {
          await tx.run(
            "INSERT INTO tracking_unattributed (id,recorded_at,raw,reason) VALUES (?,?,?,?)",
            newId(),
            Number.isFinite(location.timestamp) ? location.timestamp : null,
            JSON.stringify(location),
            "No matching sharing session",
          );
          await tx.run(
            "INSERT INTO tracking_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            "error",
            "A GPS callback needs review before it can be attributed.",
          );
          continue;
        }
        const previous = await tx.first<{ payload: string }>(
          `SELECT payload FROM tracking_events WHERE stream_id=? AND json_extract(payload,'$.kind')='location' ORDER BY sequence DESC LIMIT 1`,
          stream.id,
        );
        if (previous) {
          const e = JSON.parse(previous.payload) as TrackingEvent;
          const gap = location.timestamp - Date.parse(e.recordedAt);
          if (gap > 120000)
            await append(tx, stream, "status", location.timestamp, {
              code: "gps_gap",
              gapMs: gap,
              previousRecordedAt: e.recordedAt,
            });
        }
        await append(tx, stream, "location", location.timestamp, location);
        await tx.run(
          "INSERT INTO tracking_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(tracking_meta.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)",
          "lastFixAt",
          String(location.timestamp),
        );
      }
    });
  }
  async function stop(reason = "driver_stopped", boundary?: number) {
    await db.transaction(async (tx) => {
      const stream = await tx.first<LocalStream>(
        "SELECT * FROM tracking_streams WHERE stopped_at IS NULL ORDER BY started_at DESC LIMIT 1",
      );
      if (!stream) return;
      const at =
        boundary === undefined
          ? now()
          : Math.max(stream.started_at, Math.min(now(), boundary));
      await append(tx, stream, "status", at, {
        code: "tracking_stopped",
        reason,
      });
      await tx.run(
        "UPDATE tracking_streams SET stopped_at=?,end_reported=0 WHERE id=?",
        at,
        stream.id,
      );
    });
  }
  async function batch(): Promise<Batch | null> {
    const stream = await db.first<LocalStream>(
      `SELECT s.* FROM tracking_streams s WHERE EXISTS(SELECT 1 FROM tracking_events e WHERE e.stream_id=s.id AND e.acknowledged_at IS NULL AND e.blocked_reason IS NULL AND e.retry_after<=?) OR (s.stopped_at IS NOT NULL AND s.end_reported=0 AND NOT EXISTS(SELECT 1 FROM tracking_events e WHERE e.stream_id=s.id AND e.acknowledged_at IS NULL AND e.blocked_reason IS NULL)) ORDER BY s.started_at LIMIT 1`,
      now(),
    );
    if (!stream) return null;
    const events = await db.all<{ payload: string }>(
      "SELECT payload FROM tracking_events WHERE stream_id=? AND acknowledged_at IS NULL AND blocked_reason IS NULL AND retry_after<=? ORDER BY sequence LIMIT 100",
      stream.id,
      now(),
    );
    if (events.length) {
      // Leave room under the API's JSON limit even for multibyte status text.
      let budget = 1024;
      const bounded = [];
      for (const event of events) {
        if (bounded.length && budget + event.payload.length * 3 > 95000) break;
        bounded.push(event);
        budget += event.payload.length * 3;
      }
      return {
        batchId: newId(),
        streamId: stream.id,
        events: bounded.map((e) => JSON.parse(e.payload)),
      };
    }
    return {
      batchId: newId(),
      streamId: stream.id,
      events: [],
      end: {
        at: new Date(stream.stopped_at!).toISOString(),
        finalSequence: stream.next_sequence - 1,
      },
    };
  }
  async function receipt(sent: Batch, r: Receipt) {
    if (
      r.batchId !== sent.batchId ||
      r.streamId !== sent.streamId ||
      !Array.isArray(r.acceptedIds) ||
      !Array.isArray(r.rejected) ||
      typeof r.captureAllowed !== "boolean" ||
      typeof r.closed !== "boolean"
    )
      throw new Error("Invalid tracking receipt.");
    const ids = new Set(sent.events.map((e) => e.eventId));
    const covered = new Set([
      ...r.acceptedIds,
      ...r.rejected.map((e) => e.eventId),
    ]);
    if (
      covered.size !== ids.size ||
      r.acceptedIds.length + r.rejected.length !== ids.size ||
      r.acceptedIds.some((id) => !ids.has(id)) ||
      r.rejected.some(
        (e) => !ids.has(e.eventId) || typeof e.reason !== "string",
      )
    )
      throw new Error("Tracking receipt does not match the outbox.");
    await db.transaction(async (tx) => {
      for (const id of r.acceptedIds)
        await tx.run(
          "UPDATE tracking_events SET acknowledged_at=?,blocked_reason=NULL WHERE event_id=? AND stream_id=?",
          now(),
          id,
          sent.streamId,
        );
      for (const item of r.rejected)
        await tx.run(
          "UPDATE tracking_events SET blocked_reason=? WHERE event_id=? AND stream_id=?",
          item.reason.slice(0, 500),
          item.eventId,
          sent.streamId,
        );
      if (sent.end && r.closed)
        await tx.run(
          "UPDATE tracking_streams SET end_reported=1 WHERE id=? AND next_sequence=?",
          sent.streamId,
          sent.end.finalSequence + 1,
        );
      await tx.run(
        "INSERT INTO tracking_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        "lastSyncAt",
        String(now()),
      );
    });
  }
  async function failed(sent: Batch, error: string) {
    await db.transaction(async (tx) => {
      for (const e of sent.events) {
        const row = await tx.first<{ attempts: number }>(
          "SELECT attempts FROM tracking_events WHERE event_id=?",
          e.eventId,
        );
        const attempts = (row?.attempts ?? 0) + 1;
        await tx.run(
          "UPDATE tracking_events SET attempts=?,retry_after=? WHERE event_id=? AND acknowledged_at IS NULL",
          attempts,
          now() +
            Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)) +
            Math.floor(Math.random() * 1000),
          e.eventId,
        );
      }
    });
    await meta("error", error);
  }
  async function status(): Promise<TrackingStatus> {
    const counts = await db.first<{ pending: number; blocked: number }>(
      "SELECT COALESCE(SUM(CASE WHEN acknowledged_at IS NULL AND blocked_reason IS NULL THEN 1 ELSE 0 END),0) pending,COALESCE(SUM(CASE WHEN blocked_reason IS NOT NULL THEN 1 ELSE 0 END),0) blocked FROM tracking_events",
    );
    const rows = Object.fromEntries(
      (
        await db.all<{ key: string; value: string }>(
          "SELECT * FROM tracking_meta",
        )
      ).map((r) => [r.key, r.value]),
    );
    return {
      active: await active(),
      collecting: false,
      pending: counts?.pending ?? 0,
      blocked:
        (counts?.blocked ?? 0) +
        (await db.first<{ n: number }>(
          "SELECT count(*) n FROM tracking_unattributed",
        ))!.n,
      lastFixAt: Number(rows.lastFixAt) || null,
      lastSyncAt: Number(rows.lastSyncAt) || null,
      error: rows.error ?? "",
      transport: rows.transport ?? "Disconnected",
    };
  }
  async function pruneAcknowledged() {
    await db.run(
      "DELETE FROM tracking_events WHERE acknowledged_at IS NOT NULL AND acknowledged_at<?",
      now() - 7 * 86400000,
    );
  }
  async function retryNow() {
    await db.run(
      "UPDATE tracking_events SET retry_after=0 WHERE acknowledged_at IS NULL AND blocked_reason IS NULL",
    );
  }
  return {
    active,
    addStream,
    statusEvent,
    locations,
    stop,
    batch,
    receipt,
    failed,
    status,
    meta,
    pruneAcknowledged,
    retryNow,
  };
}
