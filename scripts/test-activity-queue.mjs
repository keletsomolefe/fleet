import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { activityQueue, schema } from "../apps/mobile/src/activities/queue.ts";

const directory = await mkdtemp(join(tmpdir(), "fleet-activities-"));
const dbPath = join(directory, "activities.sqlite");
let handle = new DatabaseSync(dbPath);
let clock = Date.now();

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

const sampleDelivery = () => ({
  kind: "delivery",
  occurredAt: new Date(clock).toISOString(),
  arrivedAt: null,
  departedAt: null,
  dispatchId: null,
  runId: null,
  customer: { id: null, name: "Highveld Chrome" },
  product: { id: null, name: "Chrome Ore" },
  supplier: { id: null, name: "" },
  receiver: { id: null, name: "" },
  origin: { id: null, name: "North Pit" },
  destination: { id: null, name: "Port Terminal" },
  quantity: "33.5",
  collectedQuantity: "34.0",
  grossWeight: null,
  tareWeight: null,
  waybillNumber: "WB-1001",
  unit: "tonne",
  allocations: [],
  fuelLitres: null,
  fuelTotalCost: null,
  fuelStation: "",
  expenseCategory: null,
  expenseAmount: null,
  vendorName: "",
  receiptNumber: "",
  odometerKm: "284650",
  transportCharge: true,
  outcome: "completed",
  note: "Delivered cleanly",
  latitude: -25.7479,
  longitude: 28.2293,
  accuracy: 10,
});

try {
  let db = adapter();
  await db.exec(schema);
  let q = activityQueue(db, randomUUID, () => clock);

  const ctx = {
    id: randomUUID(),
    driverId: randomUUID(),
    truckId: randomUUID(),
    drivingSessionId: randomUUID(),
    confirmedDate: "2026-11-25",
  };
  await q.context(ctx);

  const recordId = randomUUID();
  const ev = await q.append(ctx.id, recordId, sampleDelivery());
  assert.equal(ev.baseVersion, 0);

  // Queue a POD photo for the unsynced delivery.
  const photoId = await q.queueAttachment({
    ownerType: "record",
    ownerId: recordId,
    contextId: ctx.id,
    kind: "pod",
    localUri: "file:///tmp/pod.jpg",
    mimeType: "image/jpeg",
  });
  // Photo must wait until the parent record is acknowledged (version > 0).
  assert.equal((await q.pendingAttachments()).length, 0);

  // Simulate app termination & reopen of the SQLite file.
  handle.close();
  handle = new DatabaseSync(dbPath);
  db = adapter();
  await db.exec(schema);
  q = activityQueue(db, randomUUID, () => clock);

  const batch = await q.pendingBatch();
  assert.ok(batch);
  assert.equal(batch.events.length, 1);
  assert.equal(batch.events[0].id, ev.id);

  // Apply receipt acknowledging the delivery -> unlocks pending photo upload.
  await q.applyReceipt({
    accepted: [{ id: ev.id, recordId, version: 1, conflict: false }],
    rejected: [],
    stopCapture: false,
    receivedAt: new Date(clock).toISOString(),
  });
  const readyPhotos = await q.pendingAttachments();
  assert.equal(readyPhotos.length, 1);
  assert.equal(readyPhotos[0].id, photoId);

  await q.markAttachmentUploaded(photoId);
  assert.equal((await q.counts()).pending, 0);

  // Review sync updates local review badge without losing record data.
  await q.reviews([{ id: recordId, version: 2, review: "validated" }]);
  const recs = await q.records(ctx.driverId);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].review, "validated");
  assert.equal(recs[0].version, 2);

  // Shift odometer photo can upload immediately (doesn't wait on activity_records).
  const shiftPhotoId = await q.queueAttachment({
    ownerType: "shift",
    ownerId: ctx.drivingSessionId,
    contextId: null,
    kind: "start_odometer_photo",
    localUri: "file:///tmp/odo.jpg",
    mimeType: "image/jpeg",
  });
  assert.equal((await q.pendingAttachments()).length, 1);
  await q.markAttachmentUploaded(shiftPhotoId);

  // Rejected event is marked blocked; stopCapture deactivates context.
  const badRecordId = randomUUID();
  const badEv = await q.append(ctx.id, badRecordId, sampleDelivery());
  await q.applyReceipt({
    accepted: [],
    rejected: [{ id: badEv.id, reason: "Rejected test entry" }],
    stopCapture: true,
    receivedAt: new Date(clock).toISOString(),
  });
  assert.equal(await q.active(), null);
  assert.equal((await q.counts()).blocked, 1);

  console.log("PASS offline activity and photo SQLite queue checks");
} finally {
  handle.close();
  await rm(directory, { recursive: true, force: true });
}
