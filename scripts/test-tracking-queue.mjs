import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { queue, schema } from "../apps/mobile/src/tracking/queue.ts";

const directory = await mkdtemp(join(tmpdir(), "fleet-outbox-")),
  path = join(directory, "queue.sqlite");
let handle = new DatabaseSync(path),
  clock = Date.now();
function adapter() {
  return {
    exec: async (sql) => {
      handle.exec(sql);
    },
    run: async (sql, ...args) => {
      handle.prepare(sql).run(...args);
    },
    first: async (sql, ...args) => handle.prepare(sql).get(...args) ?? null,
    all: async (sql, ...args) => handle.prepare(sql).all(...args),
    transaction: async (action) => {
      handle.exec("BEGIN IMMEDIATE");
      try {
        const result = await action(adapter());
        handle.exec("COMMIT");
        return result;
      } catch (error) {
        handle.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
let db = adapter();
await db.exec(schema);
let q = queue(db, randomUUID, () => clock);
const stream = {
  id: randomUUID(),
  device_id: randomUUID(),
  driver_id: randomUUID(),
  truck_id: randomUUID(),
  association_id: randomUUID(),
  started_at: clock,
};
const location = (at, latitude = -26.2) => ({
  timestamp: at,
  coords: {
    latitude,
    longitude: 28.04,
    accuracy: 5,
    altitude: 1700,
    altitudeAccuracy: 2,
    speed: 12,
    heading: 84,
  },
  mocked: false,
});
const receipt = (batch) => ({
  batchId: batch.batchId,
  streamId: batch.streamId,
  acceptedIds: batch.events.map((e) => e.eventId),
  rejected: [],
  captureAllowed: true,
  closed: !!batch.end,
  receivedAt: new Date(clock).toISOString(),
});
try {
  await q.addStream(stream);
  await q.statusEvent("tracking_started");
  await q.locations([location(clock)]);
  const original = await q.batch();
  assert.equal(original.events.length, 2);
  assert.equal(original.events[1].data.coords.altitude, 1700);
  // Simulate process death before any network receipt, then reopen the actual file.
  handle.close();
  handle = new DatabaseSync(path);
  db = adapter();
  await db.exec(schema);
  q = queue(db, randomUUID, () => clock);
  const restarted = await q.batch();
  assert.deepEqual(restarted.events, original.events);
  assert.equal((await q.status()).pending, 2);
  await q.failed(restarted, "Network unavailable");
  assert.equal(await q.batch(), null);
  clock += 301000;
  const retry = await q.batch();
  assert.deepEqual(retry.events, restarted.events);
  await assert.rejects(
    () => q.receipt(retry, { ...receipt(retry), acceptedIds: [randomUUID()] }),
    /does not match/,
  );
  assert.equal((await q.status()).pending, 2);
  await q.receipt(retry, receipt(retry));
  assert.equal((await q.status()).pending, 0);
  console.log(
    "PASS durable SQLite reopen, immutable retry IDs, persisted backoff and receipt-scoped acknowledgement",
  );

  await q.locations([location(clock)]);
  const gap = await q.batch();
  assert.equal(gap.events[0].data.code, "gps_gap");
  assert.equal(gap.events[1].kind, "location");
  await q.receipt(gap, {
    ...receipt(gap),
    acceptedIds: [gap.events[0].eventId],
    rejected: [{ eventId: gap.events[1].eventId, reason: "Needs review" }],
  });
  assert.equal((await q.status()).blocked, 1);
  assert.equal((await q.status()).pending, 0);
  const retained = handle
    .prepare("SELECT * FROM tracking_events WHERE event_id=?")
    .get(gap.events[1].eventId);
  assert.equal(retained.acknowledged_at, null);
  assert.ok(retained.payload.includes("altitude"));
  console.log(
    "PASS explicit GPS gap events and rejected records retained with their original measurements",
  );

  const boundary = clock;
  await q.stop();
  clock += 1;
  const second = {
    ...stream,
    id: randomUUID(),
    driver_id: randomUUID(),
    started_at: clock,
  };
  await q.addStream(second);
  await q.locations([location(boundary - 1000), location(clock)]);
  const old = handle
    .prepare(
      "SELECT stream_id FROM tracking_events WHERE json_extract(payload,'$.recordedAt')=? AND json_extract(payload,'$.kind')='location'",
    )
    .get(new Date(boundary - 1000).toISOString());
  assert.equal(old.stream_id, stream.id);
  await q.locations([location(stream.started_at - 60000)]);
  assert.equal(
    handle.prepare("SELECT count(*) n FROM tracking_unattributed").get().n,
    1,
  );
  assert.equal((await q.active()).driver_id, second.driver_id);
  await q.pruneAcknowledged();
  assert.ok(
    handle
      .prepare("SELECT 1 FROM tracking_events WHERE event_id=?")
      .get(gap.events[1].eventId),
  );
  console.log(
    "PASS late callbacks retain original driver attribution, unattributed fixes remain local, and unacknowledged records are never pruned",
  );

  const before = handle
    .prepare("SELECT count(*) n FROM tracking_events")
    .get().n;
  const failing = queue(
    {
      ...db,
      transaction: async (action) => {
        handle.exec("BEGIN IMMEDIATE");
        try {
          await action({
            ...adapter(),
            run: async (sql, ...args) => {
              if (sql.startsWith("UPDATE tracking_streams SET next_sequence"))
                throw new Error("Simulated disk error");
              await adapter().run(sql, ...args);
            },
          });
          handle.exec("COMMIT");
        } catch (error) {
          handle.exec("ROLLBACK");
          throw error;
        }
      },
    },
    randomUUID,
    () => clock,
  );
  await assert.rejects(
    () => failing.locations([location(clock)]),
    /disk error/,
  );
  assert.equal(
    handle.prepare("SELECT count(*) n FROM tracking_events").get().n,
    before,
  );
  console.log(
    "PASS atomic sequence allocation rolls back a failed disk transaction without acknowledging or overwriting history",
  );
} finally {
  handle.close();
  await rm(directory, { recursive: true, force: true });
}
