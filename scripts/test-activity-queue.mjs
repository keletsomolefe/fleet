import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { activityQueue, schema } from "../apps/mobile/src/activities/queue.ts";
const dir = await mkdtemp(join(tmpdir(), "fleet-activities-")),
  path = join(dir, "activities.sqlite");
let db = new DatabaseSync(path),
  clock = Date.now();
function adapter() {
  return {
    exec: async (s) => db.exec(s),
    run: async (s, ...args) => {
      db.prepare(s).run(...args);
    },
    first: async (s, ...args) => db.prepare(s).get(...args) ?? null,
    all: async (s, ...args) => db.prepare(s).all(...args),
    transaction: async (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const r = await fn(adapter());
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
let q = activityQueue(adapter(), randomUUID, () => clock);
const context = {
  id: randomUUID(),
  driverId: randomUUID(),
  truckId: randomUUID(),
  drivingSessionId: randomUUID(),
  confirmedDate: "2026-10-25",
};
const data = {
  kind: "delivery",
  occurredAt: new Date(clock).toISOString(),
  customer: { id: null, name: "New customer" },
  product: { id: null, name: "Coal" },
  quantity: "34",
  unit: "tonne",
};
const ack = (batch) => ({
  accepted: batch.events.map((e) => ({
    id: e.id,
    recordId: e.recordId,
    version: e.baseVersion + 1,
    conflict: false,
  })),
  rejected: [],
  stopCapture: false,
  receivedAt: new Date(clock).toISOString(),
});
try {
  db.exec(schema);
  await q.context(context);
  const recordId = randomUUID();
  await q.append(context.id, recordId, data);
  await q.draft("draft", { recordId, data });
  await q.cache("catalogue", { customers: [data.customer] });
  const first = await q.batch();
  db.close();
  db = new DatabaseSync(path);
  db.exec(schema);
  q = activityQueue(adapter(), randomUUID, () => clock);
  assert.deepEqual(await q.batch(), first);
  assert.equal((await q.draft("draft")).data.quantity, "34");
  assert.equal((await q.active()).driverId, context.driverId);
  console.log(
    "PASS durable logs, draft, catalogue and context survive restart",
  );
  await q.failed(first, "Offline");
  assert.equal(await q.batch(), null);
  assert.deepEqual(await q.batch(true), first);
  await assert.rejects(
    () => q.receipt(first, { ...ack(first), accepted: [] }),
    /did not confirm/,
  );
  assert.equal((await q.status()).pending, 1);
  await q.receipt(first, ack(first));
  assert.equal((await q.status()).pending, 0);
  console.log("PASS persisted backoff, forced sync and exact receipt coverage");
  await q.append(context.id, recordId, { ...data, quantity: "35" });
  await q.append(context.id, recordId, { ...data, quantity: "36" });
  const second = await q.batch();
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].baseVersion, 1);
  await q.receipt(second, ack(second));
  const third = await q.batch();
  assert.equal(third.events[0].baseVersion, 2);
  await q.receipt(third, {
    ...ack(third),
    accepted: [],
    rejected: [{ id: third.events[0].id, reason: "Needs review" }],
  });
  assert.equal((await q.status()).blocked, 1);
  assert.ok(
    db
      .prepare("SELECT payload FROM activity_events WHERE id=?")
      .get(third.events[0].id),
  );
  console.log(
    "PASS ordered revisions and rejected records retained for recovery",
  );
  await q.stop();
  await assert.rejects(
    () => q.append(context.id, randomUUID(), data),
    /Confirm/,
  );
  assert.equal((await q.status()).blocked, 1);
  clock += 86400000;
  await q.context(context);
  await q.append(context.id, randomUUID(), {
    ...data,
    occurredAt: new Date(clock).toISOString(),
  });
  assert.ok(await q.batch());
  console.log(
    "PASS explicit stop preserves pending records; offline continuation crosses days",
  );
  db.exec(
    "CREATE TRIGGER disk_failure BEFORE INSERT ON activity_records BEGIN SELECT RAISE(ABORT,'disk full'); END",
  );
  const count = db.prepare("SELECT count(*) AS n FROM activity_events").get().n;
  await assert.rejects(
    () => q.append(context.id, randomUUID(), data),
    /disk full/,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM activity_events").get().n,
    count,
  );
  console.log("PASS storage failure rolls back the log and its outbox event");
} finally {
  db.close();
  await rm(dir, { recursive: true, force: true });
}
