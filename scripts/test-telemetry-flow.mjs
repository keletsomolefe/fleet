import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

export async function testTelemetry({
  mobile,
  request,
  db,
  env,
  driverToken,
  credential,
  deviceId,
  truckId,
  driverId,
}) {
  const require = createRequire(
      new URL("../apps/mobile/package.json", import.meta.url),
    ),
    mqtt = require("mqtt");
  const config = await mobile("telemetry/config", { device: credential });
  assert.equal(config.status, 200, JSON.stringify(config.body));
  assert.ok(config.body.mqttUrl, "Enable MQTT in local .env");
  assert.equal(
    (
      await mobile("telemetry/streams", {
        method: "POST",
        device: credential,
        body: { streamId: randomUUID() },
      })
    ).status,
    401,
  );
  const streamId = randomUUID(),
    start = () =>
      mobile("telemetry/streams", {
        method: "POST",
        token: driverToken,
        device: credential,
        body: { streamId },
      });
  const started = await start();
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal((await start()).body.id, streamId);
  const event = (sequence, at = Date.now()) => ({
    eventId: randomUUID(),
    sequence,
    kind: "location",
    recordedAt: new Date(at).toISOString(),
    data: {
      timestamp: at,
      coords: {
        latitude: -26.2 + sequence / 100000,
        longitude: 28.04,
        accuracy: sequence === 2 ? 500 : 5,
        altitude: 1700,
        altitudeAccuracy: 2,
        heading: 88,
        speed: 12,
      },
      mocked: false,
    },
  });
  const points = [event(1), event(2, Date.now() - 1000)],
    batch = { batchId: randomUUID(), streamId, events: points };
  const first = await mobile("telemetry/batches", {
    method: "POST",
    device: credential,
    body: batch,
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(
    first.body.acceptedIds,
    points.map((p) => p.eventId),
  );
  assert.equal(
    (
      await mobile("telemetry/batches", {
        method: "POST",
        device: credential,
        body: batch,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app.tracking_events WHERE "streamId"=$1',
        [streamId],
      )
    ).rows[0].n,
    2,
  );
  const changed = {
    ...points[0],
    data: {
      ...points[0].data,
      coords: { ...points[0].data.coords, latitude: 0 },
    },
  };
  const conflict = await mobile("telemetry/batches", {
    method: "POST",
    device: credential,
    body: { ...batch, batchId: randomUUID(), events: [changed] },
  });
  assert.equal(conflict.status, 200);
  assert.equal(conflict.body.acceptedIds.length, 0);
  assert.equal(conflict.body.rejected.length, 1);
  const invalid = {
    ...event(4),
    data: { coords: { latitude: 91, longitude: 0 } },
  };
  const partial = await mobile("telemetry/batches", {
    method: "POST",
    device: credential,
    body: { ...batch, batchId: randomUUID(), events: [event(3), invalid] },
  });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.acceptedIds.length, 1);
  assert.equal(partial.body.rejected[0].eventId, invalid.eventId);
  console.log(
    "PASS tracking grant, HTTP replay deduplication, immutable history, raw measurement preservation and explicit partial rejection",
  );

  const socket = mqtt.connect(config.body.mqttUrl, {
    username: deviceId,
    password: credential,
    clientId: `fleet-${deviceId}-${randomUUID()}`,
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 5000,
  });
  const receiptTopic = `fleet/devices/${deviceId}/receipts`,
    publishTopic = `fleet/devices/${deviceId}/locations`;
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const denied = await new Promise((resolve) =>
      socket.subscribe(
        `fleet/devices/${randomUUID()}/receipts`,
        { qos: 1 },
        (error, granted) =>
          resolve(!!error || granted?.some((g) => g.qos === 128)),
      ),
    );
    assert.equal(denied, true, "Cross-device subscriptions denied");
    await new Promise((resolve, reject) =>
      socket.subscribe(receiptTopic, { qos: 1 }, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    const fourth = event(4),
      wire = { batchId: randomUUID(), streamId, events: [fourth] };
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Missing durable MQTT receipt")),
        8000,
      );
      socket.on("message", (_topic, payload) => {
        const r = JSON.parse(payload.toString());
        if (r.batchId === wire.batchId) {
          clearTimeout(timer);
          resolve(r);
        }
      });
    });
    socket.publish(publishTopic, JSON.stringify(wire), { qos: 1 });
    const r = await acknowledgement;
    assert.deepEqual(r.acceptedIds, [fourth.eventId]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM app.tracking_events WHERE id=$1",
          [fourth.eventId],
        )
      ).rows[0].n,
      1,
      "Receipt follows committed PostgreSQL row",
    );
    assert.equal(
      (
        await mobile("telemetry/batches", {
          method: "POST",
          device: credential,
          body: wire,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM app.tracking_events WHERE "streamId"=$1',
          [streamId],
        )
      ).rows[0].n,
      4,
    );
  } finally {
    await new Promise((resolve) => socket.end(true, {}, resolve));
  }
  const invalidClient = mqtt.connect(config.body.mqttUrl, {
    username: deviceId,
    password: randomBytes(32).toString("hex"),
    clientId: `bad-${randomUUID()}`,
    reconnectPeriod: 0,
    connectTimeout: 5000,
  });
  try {
    const denied = await new Promise((resolve) => {
      invalidClient.once("connect", () => resolve(false));
      invalidClient.once("error", () => resolve(true));
    });
    assert.equal(denied, true);
  } finally {
    invalidClient.end(true);
  }
  console.log(
    "PASS authenticated MQTT QoS 1, per-device topic isolation, database receipts and HTTP fallback without duplicate history",
  );

  // Backfill more than one history page and preserve fixes arriving out of chronological order.
  for (let offset = 5; offset <= 1005; offset += 100) {
    const events = Array.from(
      { length: Math.min(100, 1006 - offset) },
      (_, i) => event(offset + i, Date.now() - 5000 + (offset + i)),
    );
    const result = await mobile("telemetry/batches", {
      method: "POST",
      device: credential,
      body: { batchId: randomUUID(), streamId, events },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.acceptedIds.length, events.length);
  }
  const close = await mobile("telemetry/batches", {
    method: "POST",
    device: credential,
    body: {
      batchId: randomUUID(),
      streamId,
      events: [],
      end: { at: new Date().toISOString(), finalSequence: 1005 },
    },
  });
  assert.equal(close.status, 200);
  assert.equal(close.body.closed, true);
  const raw = (
    await db.query(
      'SELECT raw FROM app.tracking_events WHERE "streamId"=$1 AND sequence=2',
      [streamId],
    )
  ).rows[0].raw;
  assert.equal(raw.coords.accuracy, 500);
  assert.equal(raw.coords.altitude, 1700);

  // Exercise the permission-guarded admin endpoints with a real Kratos browser session.
  const jar = new Map(),
    cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function browser(path, options = {}, base = env.KRATOS_PUBLIC_URL) {
    const r = await fetch(new URL(path, base), {
      ...options,
      headers: {
        Accept: "application/json",
        Cookie: cookie(),
        ...options.headers,
      },
    });
    for (const v of r.headers.getSetCookie()) {
      const pair = v.split(";")[0],
        i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { status: r.status, body: await r.json() };
  }
  const flow = await browser("self-service/login/browser");
  const csrf = flow.body.ui.nodes.find(
    (n) => n.attributes.name === "csrf_token",
  ).attributes.value;
  const signedIn = await browser(flow.body.ui.action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "password",
      identifier: env.BOOTSTRAP_ADMIN_EMAIL,
      password: env.BOOTSTRAP_ADMIN_PASSWORD,
      csrf_token: csrf,
    }),
  });
  assert.equal(signedIn.status, 200);
  assert.equal((await request("api/admin/telemetry/latest")).status, 401);
  const admin = (path) =>
    browser(`api/admin/telemetry/${path}`, {}, env.APP_URL);
  const integrity = await admin(`streams/${streamId}/integrity`);
  assert.equal(integrity.status, 200);
  assert.equal(integrity.body.complete, true);
  assert.equal(integrity.body.receivedCount, 1005);
  assert.deepEqual(integrity.body.missingRanges, []);
  const qs = new URLSearchParams({
    from: new Date(Date.now() - 60000).toISOString(),
    to: new Date(Date.now() + 60000).toISOString(),
  });
  const page1 = await admin(`trucks/${truckId}/history?${qs}`);
  assert.equal(page1.status, 200);
  assert.equal(page1.body.events.length, 1000);
  assert.equal(page1.body.features.length, 1000);
  assert.ok(page1.body.nextCursor);
  const page2 = await admin(
    `trucks/${truckId}/history?${qs}&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
  );
  assert.equal(page2.status, 200);
  assert.equal(page2.body.events.length, 5);
  assert.equal(page2.body.nextCursor, null);
  assert.equal(
    new Set([...page1.body.events, ...page2.body.events].map((e) => e.id)).size,
    1005,
  );
  const latest = await admin("latest");
  assert.equal(latest.status, 200);
  assert.ok(latest.body.some((e) => e.truckId === truckId));
  const streams = await admin(`trucks/${truckId}/streams`);
  assert.equal(streams.status, 200);
  assert.ok(streams.body.some((s) => s.id === streamId));
  console.log(
    "PASS sequence completeness, 1,005-record backfill, chronological GeoJSON pagination and protected latest/history/integrity APIs",
  );
}
