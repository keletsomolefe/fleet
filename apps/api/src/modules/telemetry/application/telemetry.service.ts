import type { MikroORM } from '@mikro-orm/postgresql';
import {
  acquireAdvisoryLock,
  dbClockTimestamp,
  getEm,
  rawQuery,
} from '../../../database/context.js';
import { operationalToday } from '../../../shared/calendar-date.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../shared/errors.js';
import { hashDeviceToken } from '../../../shared/identifiers.js';
import type { DrivingService } from '../../driving/application/driving.service.js';
import { DrivingSession } from '../../driving/domain/driving-session.entity.js';
import { VehicleDispute } from '../../driving/domain/vehicle-dispute.entity.js';
import { TruckDevice } from '../../fleet/domain/device.entity.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import {
  KratosError,
  type KratosService,
  type KratosSession,
} from '../../identity/infrastructure/kratos.service.js';
import { DriverSchedule } from '../../scheduling/domain/driver-schedule.entity.js';
import { TrackingEvent } from '../domain/tracking-event.entity.js';
import { TrackingStream } from '../domain/tracking-stream.entity.js';
import {
  digest,
  instant,
  missingRanges,
  parseBatch,
  parseSample,
  uuid,
} from '../http/telemetry.dto.js';

export class TelemetryService {
  constructor(
    private readonly orm: MikroORM,
    private readonly driving: DrivingService,
    private readonly kratos: KratosService,
  ) {}

  async device(token: string) {
    const em = getEm(this.orm);
    const hash = hashDeviceToken(token);
    const personal = await em.findOne(TrackingStream, {
      uploadTokenHash: hash,
    });
    if (personal) return { id: personal.id };
    const device = await em.findOne(TruckDevice, { credentialHash: hash });
    if (!device) {
      throw new UnauthorizedError(
        'Location sharing access has ended. Start sharing again.',
      );
    }
    return { id: device.id };
  }

  async config(token: string) {
    const device = await this.device(token);
    const url = process.env.MQTT_PUBLIC_URL ?? 'ws://127.0.0.1:1884/mqtt';
    if (process.env.NODE_ENV === 'production' && !url.startsWith('wss://')) {
      throw new BadRequestError('Secure MQTT transport is not configured.');
    }
    return {
      deviceId: device.id,
      mqttUrl: process.env.MQTT_ENABLED === 'true' ? url : null,
      sampleIntervalMs: 10_000,
      batchSize: 100,
    };
  }

  async start(context: AdminContext, input: unknown) {
    const v = input as Record<string, unknown> | null;
    if (
      !v ||
      typeof v !== 'object' ||
      Array.isArray(v) ||
      Object.keys(v).some(
        (k) => !['streamId', 'drivingSessionId', 'uploadToken'].includes(k),
      )
    ) {
      throw new BadRequestError('Invalid tracking start.');
    }
    const id = uuid(v.streamId);
    const drivingSessionId = uuid(v.drivingSessionId);
    const uploadTokenHash = hashDeviceToken(
      typeof v.uploadToken === 'string' ? v.uploadToken : '',
    );

    return getEm(this.orm).transactional(async (tx) => {
      await tx.execute('SET LOCAL synchronous_commit = on');
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const state = await this.driving.context(context, tx);
      if (
        !state.canDrive ||
        !state.confirmedAt ||
        !state.truck ||
        !state.drivingSession?.onThisPhone ||
        state.drivingSession.id !== drivingSessionId
      ) {
        throw new ForbiddenError('Confirm your truck before sharing location.');
      }

      const existing = await tx.findOne(TrackingStream, { id });
      if (existing) {
        const storedHashRows = await rawQuery<{ uploadTokenHash: string | null }>(
          tx,
          'SELECT "uploadTokenHash" FROM app.tracking_streams WHERE id = $1',
          [id],
        );
        if (
          existing.drivingSession?.id !== drivingSessionId ||
          existing.driver.id !== state.driver.id ||
          existing.kratosSessionId !== context.session.id ||
          existing.endedAt ||
          (storedHashRows[0]?.uploadTokenHash ?? null) !== uploadTokenHash
        ) {
          throw new ConflictError('Start a new location sharing session.');
        }
        return {
          id: existing.id,
          deviceId: existing.id,
          driverId: existing.driver.id,
          associationId: drivingSessionId,
          startedAt: existing.startedAt,
        };
      }

      const startedAt = await dbClockTimestamp(tx);
      await tx.nativeUpdate(
        TrackingStream,
        { drivingSession: drivingSessionId, endedAt: null },
        { endedAt: startedAt },
      );

      const stream = tx.create(TrackingStream, {
        id,
        device: null,
        driver: tx.getReference(DriverProfile, state.driver.id),
        association: null,
        drivingSession: tx.getReference(DrivingSession, drivingSessionId),
        uploadTokenHash,
        kratosSessionId: context.session.id,
        startedAt,
        endedAt: null,
        finalSequence: null,
      });
      await tx.persist(stream).flush();
      return {
        id: stream.id,
        deviceId: stream.id,
        driverId: stream.driver.id,
        associationId: drivingSessionId,
        startedAt: stream.startedAt,
      };
    });
  }

  async ingest(token: string, input: unknown) {
    const batch = parseBatch(input);
    const credentialHash = hashDeviceToken(token);
    const em = getEm(this.orm);

    const candidate = await em.findOne(TrackingStream, {
      id: batch.streamId,
      uploadTokenHash: credentialHash,
    });

    let validSession = true;
    let sessionEndsAt: Date | null = null;
    if (candidate && !candidate.endedAt) {
      try {
        const session = await this.kratos.request<KratosSession>(
          `admin/sessions/${candidate.kratosSessionId}?expand=identity`,
          {},
          true,
        );
        validSession =
          session.active &&
          Boolean(session.identity) &&
          session.identity.state !== 'inactive';
        sessionEndsAt = session.expires_at
          ? new Date(session.expires_at)
          : null;
        if (sessionEndsAt && sessionEndsAt <= new Date()) validSession = false;
      } catch (error) {
        if (
          error instanceof KratosError &&
          [401, 403, 404].includes(error.status)
        ) {
          validSession = false;
        } else {
          throw error;
        }
      }
    }

    // This transaction commits before a business receipt is returned by HTTP or MQTT.
    return em.transactional(async (tx) => {
      await tx.execute('SET LOCAL synchronous_commit = on');
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      await tx.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [
        `tracking:${batch.streamId}`,
      ]);

      const personal = await tx.findOne(TrackingStream, {
        id: batch.streamId,
        uploadTokenHash: credentialHash,
      });
      const device = personal
        ? null
        : await tx.findOne(TruckDevice, { credentialHash });
      if (!personal && !device) {
        throw new UnauthorizedError('Location sharing access has ended.');
      }

      const stream =
        personal ??
        (await tx.findOne(TrackingStream, {
          id: batch.streamId,
          device: device!.id,
        }));
      if (!stream) throw new NotFoundError('Tracking session not found.');

      const drive = stream.drivingSession
        ? await tx.findOne(DrivingSession, { id: stream.drivingSession.id })
        : null;

      const accessRows = await rawQuery<{ allowed: boolean }>(
        tx,
        `SELECT EXISTS(
          SELECT 1
          FROM app.driver_profiles p
          JOIN app.users u ON u.id = p."userId"
          JOIN app.trucks t ON t.id = COALESCE(
            (SELECT "truckId" FROM app.driving_sessions WHERE id = $3),
            (SELECT "truckId" FROM app.device_truck_associations WHERE id = $2)
          )
          WHERE p.id = $1 AND p.status = 'active' AND u."isActive" AND t.status = 'active'
            AND p."licenceExpiresOn" >= (now() AT TIME ZONE 'Africa/Johannesburg')::date
            AND p."prdpExpiresOn" >= (now() AT TIME ZONE 'Africa/Johannesburg')::date
            AND p."prdpNumber" IS NOT NULL
            AND EXISTS(
              SELECT 1 FROM app.user_roles ur
              JOIN app.role_permissions rp ON rp."roleId" = ur."roleId"
              JOIN app.permissions pm ON pm.id = rp."permissionId"
              WHERE ur."userId" = u.id AND pm.key = 'driver.access'
            )
        ) AS allowed`,
        [
          stream.driver.id,
          stream.association?.id ?? null,
          stream.drivingSession?.id ?? null,
        ],
      );
      const access = accessRows[0]?.allowed ?? false;

      const todayDate = operationalToday();
      const schedule = drive
        ? await tx.findOne(DriverSchedule, {
            driver: drive.driver.id,
            date: todayDate,
            cancelledAt: null,
          })
        : null;

      const dayEndsAt = drive
        ? new Date(
            Date.parse(`${drive.confirmedDate}T00:00:00Z`) + 22 * 3_600_000,
          )
        : null;
      if (
        dayEndsAt &&
        dayEndsAt <= new Date() &&
        (!stream.endedAt || dayEndsAt < stream.endedAt)
      ) {
        stream.endedAt = dayEndsAt;
      }

      const scheduleAllowed =
        Boolean(drive) &&
        drive!.confirmedDate === todayDate &&
        (drive!.schedule?.id ?? null) === (schedule?.id ?? null) &&
        (await tx.count(VehicleDispute, {
          driver: drive!.driver.id,
          kind: 'schedule',
          scheduleDate: todayDate,
          resolvedAt: null,
        })) === 0;

      const captureAllowed =
        scheduleAllowed &&
        access &&
        validSession &&
        !stream.endedAt &&
        Boolean(drive) &&
        !drive!.endedAt;

      if (
        drive?.endedAt &&
        (!stream.endedAt || drive.endedAt < stream.endedAt)
      ) {
        stream.endedAt = drive.endedAt;
      }
      if (!captureAllowed && !stream.endedAt) {
        stream.endedAt =
          sessionEndsAt && sessionEndsAt < new Date()
            ? sessionEndsAt
            : new Date();
      }
      await tx.flush();

      const acceptedIds: string[] = [];
      const rejected: Array<{ eventId: string; reason: string }> = [];
      const parsed: ReturnType<typeof parseSample>[] = [];

      for (const raw of batch.events) {
        let eventId: string;
        try {
          eventId = uuid((raw as { eventId?: unknown })?.eventId);
        } catch {
          throw new BadRequestError(
            'A tracking record has no valid identifier.',
          );
        }
        try {
          parsed.push(parseSample(raw));
        } catch (error) {
          rejected.push({
            eventId,
            reason:
              error instanceof Error
                ? error.message
                : 'Invalid tracking record.',
          });
        }
      }

      const existing = parsed.length
        ? await tx.find(TrackingEvent, {
            $or: [
              { id: { $in: parsed.map((p) => p.eventId) } },
              {
                stream: stream.id,
                sequence: { $in: parsed.map((p) => p.sequence) },
              },
            ],
          })
        : [];

      type StoredRef = {
        id: string;
        streamId: string;
        sequence: number;
        digest: string;
      };
      const byId = new Map<string, StoredRef>(
        existing.map((e) => [
          e.id,
          { id: e.id, streamId: e.stream.id, sequence: e.sequence, digest: e.digest },
        ]),
      );
      const bySequence = new Map<number, StoredRef>(
        existing
          .filter((e) => e.stream.id === stream.id)
          .map((e) => [
            e.sequence,
            { id: e.id, streamId: e.stream.id, sequence: e.sequence, digest: e.digest },
          ]),
      );

      const inserts: unknown[][] = [];
      for (const sample of parsed) {
        const eventId = sample.eventId;
        const hash = digest(sample);
        const duplicate = byId.get(eventId) ?? bySequence.get(sample.sequence);
        if (duplicate) {
          if (
            duplicate.id === eventId &&
            duplicate.streamId === stream.id &&
            duplicate.digest === hash
          ) {
            acceptedIds.push(eventId);
          } else {
            rejected.push({
              eventId,
              reason:
                'Record identifier or sequence conflicts with stored history.',
            });
          }
          continue;
        }
        const recorded = instant(sample.recordedAt);
        if (
          recorded < stream.startedAt ||
          (!stream.drivingSession &&
            stream.endedAt &&
            recorded > stream.endedAt)
        ) {
          rejected.push({
            eventId,
            reason:
              'Record is outside this driving session. Retained for review.',
          });
          continue;
        }
        const coords =
          sample.kind === 'location'
            ? (sample.data.coords as Record<string, number | null>)
            : null;
        inserts.push([
          eventId,
          stream.id,
          sample.sequence,
          sample.kind,
          recorded,
          coords?.latitude ?? null,
          coords?.longitude ?? null,
          coords?.accuracy ?? null,
          coords?.speed ?? null,
          coords?.heading ?? null,
          typeof sample.data.mocked === 'boolean' ? sample.data.mocked : null,
          hash,
          JSON.stringify(sample.data),
          Boolean(stream.endedAt && recorded > stream.endedAt),
        ]);
        const record: StoredRef = {
          id: eventId,
          streamId: stream.id,
          sequence: sample.sequence,
          digest: hash,
        };
        byId.set(eventId, record);
        bySequence.set(sample.sequence, record);
        acceptedIds.push(eventId);
      }

      if (inserts.length) {
        await rawQuery(
          tx,
          `INSERT INTO app.tracking_events (id,"streamId",sequence,kind,"recordedAt",latitude,longitude,accuracy,speed,heading,mocked,digest,raw,unconfirmed) VALUES ${inserts
            .map(
              (row, i) =>
                '(' + row.map((_, j) => '$' + (i * 14 + j + 1)).join(',') + ')',
            )
            .join(',')}`,
          inserts.flat(),
        );
      }

      if (batch.end) {
        const maxRows = await rawQuery<{ n: number }>(
          tx,
          'SELECT COALESCE(MAX(sequence), 0)::int AS n FROM app.tracking_events WHERE "streamId" = $1',
          [stream.id],
        );
        const maximum = Number(maxRows[0]?.n ?? 0);
        if (
          batch.end.finalSequence < maximum ||
          (stream.finalSequence !== null &&
            batch.end.finalSequence < stream.finalSequence)
        ) {
          throw new ConflictError(
            'Tracking close sequence is behind stored history.',
          );
        }
        if (batch.end.at.getTime() < stream.startedAt.getTime() - 300_000) {
          throw new BadRequestError(
            'Tracking close time is before the session.',
          );
        }
        stream.endedAt =
          stream.endedAt && stream.endedAt < batch.end.at
            ? stream.endedAt
            : batch.end.at;
        stream.finalSequence = batch.end.finalSequence;
        await tx.flush();
      }

      return {
        batchId: batch.batchId,
        streamId: stream.id,
        acceptedIds,
        rejected,
        captureAllowed: captureAllowed && !batch.end,
        closed: Boolean(batch.end),
        receivedAt: new Date().toISOString(),
      };
    });
  }

  async streams(truckId: string) {
    const em = getEm(this.orm);
    return rawQuery(
      em,
      `SELECT s.id, s."deviceId", s."driverId", s."associationId", s."drivingSessionId",
         s."startedAt", s."endedAt", s."finalSequence",
         p.identifier AS "driverIdentifier",
         COALESCE(d.identifier, 'Personal phone') AS "deviceIdentifier",
         COALESCE(ds."truckId", a."truckId") AS "truckId",
         (SELECT count(*)::int FROM app.tracking_events e WHERE e."streamId" = s.id) AS "receivedCount",
         (SELECT MAX(e."recordedAt") FROM app.tracking_events e WHERE e."streamId" = s.id AND e.kind = 'location') AS "lastFixAt"
       FROM app.tracking_streams s
       LEFT JOIN app.device_truck_associations a ON a.id = s."associationId"
       LEFT JOIN app.driving_sessions ds ON ds.id = s."drivingSessionId"
       JOIN app.driver_profiles p ON p.id = s."driverId"
       LEFT JOIN app.truck_devices d ON d.id = s."deviceId"
       WHERE COALESCE(ds."truckId", a."truckId") = $1
       ORDER BY s."startedAt" DESC
       LIMIT 100`,
      [uuid(truckId)],
    );
  }

  async integrity(streamId: string) {
    const em = getEm(this.orm);
    const stream = await em.findOne(TrackingStream, { id: uuid(streamId) });
    if (!stream) throw new NotFoundError('Tracking session not found.');
    const rows = await rawQuery<{ sequence: number }>(
      em,
      'SELECT sequence FROM app.tracking_events WHERE "streamId" = $1 ORDER BY sequence',
      [stream.id],
    );
    const ranges = missingRanges(
      rows.map((row) => row.sequence),
      stream.finalSequence,
    );
    return {
      stream: {
        id: stream.id,
        deviceId: stream.device?.id ?? null,
        driverId: stream.driver.id,
        associationId: stream.association?.id ?? null,
        drivingSessionId: stream.drivingSession?.id ?? null,
        kratosSessionId: stream.kratosSessionId,
        startedAt: stream.startedAt,
        endedAt: stream.endedAt,
        finalSequence: stream.finalSequence,
      },
      receivedCount: rows.length,
      missingRanges: ranges,
      complete:
        stream.finalSequence !== null &&
        rows.length === stream.finalSequence &&
        !ranges.length,
    };
  }

  async latest() {
    const em = getEm(this.orm);
    return rawQuery(
      em,
      `SELECT DISTINCT ON (t.id)
         t.id AS "truckId", t.identifier, t.registration,
         p.identifier AS "driverIdentifier",
         e."recordedAt", e."receivedAt", e.latitude, e.longitude,
         e.accuracy, e.speed, e.heading, e.mocked,
         s."endedAt", s.id AS "streamId",
         (e."recordedAt" < now() - interval '2 minutes') AS stale
       FROM app.tracking_events e
       JOIN app.tracking_streams s ON s.id = e."streamId"
       LEFT JOIN app.device_truck_associations a ON a.id = s."associationId"
       LEFT JOIN app.driving_sessions ds ON ds.id = s."drivingSessionId"
       JOIN app.trucks t ON t.id = COALESCE(ds."truckId", a."truckId")
       JOIN app.driver_profiles p ON p.id = s."driverId"
       WHERE e.kind = 'location'
         AND e.unconfirmed = false
         AND (COALESCE(ds."endedAt", a."endedAt") IS NULL OR e."recordedAt" <= COALESCE(ds."endedAt", a."endedAt"))
       ORDER BY t.id, e."recordedAt" DESC, e.id DESC`,
    );
  }

  async history(
    truckId: string,
    fromValue?: string,
    toValue?: string,
    cursor?: string,
  ) {
    uuid(truckId);
    const from = instant(fromValue);
    const to = instant(toValue);
    if (to <= from || to.getTime() - from.getTime() > 31 * 86_400_000) {
      throw new BadRequestError('Select a history range of up to 31 days.');
    }

    let snapshot = new Date();
    let afterTime: Date | null = null;
    let afterId: string | null = null;
    if (cursor) {
      if (cursor.length > 600) {
        throw new BadRequestError('Invalid history cursor.');
      }
      try {
        const parsed = JSON.parse(
          Buffer.from(cursor, 'base64url').toString(),
        ) as Record<string, unknown>;
        if (
          parsed.truckId !== truckId ||
          parsed.from !== from.toISOString() ||
          parsed.to !== to.toISOString()
        ) {
          throw new Error('Cursor mismatch');
        }
        snapshot = instant(parsed.snapshot);
        afterTime = instant(parsed.at);
        afterId = uuid(parsed.id);
      } catch {
        throw new BadRequestError('Invalid history cursor.');
      }
    }

    type HistoryRow = {
      id: string;
      streamId: string;
      sequence: number;
      kind: string;
      recordedAt: Date | string;
      receivedAt: Date | string;
      latitude: number | null;
      longitude: number | null;
      accuracy: number | null;
      speed: number | null;
      heading: number | null;
      mocked: boolean | null;
      digest: string;
      raw: Record<string, unknown>;
      unconfirmed: boolean;
      driverId: string;
      deviceId: string | null;
      drivingSessionId: string | null;
      truckId: string;
      bindingStartedAt: Date | string;
      bindingEndedAt: Date | string | null;
      outsideBindingInterval: boolean;
    };

    const em = getEm(this.orm);
    const rows = await rawQuery<HistoryRow>(
      em,
      `SELECT e.*, s."driverId", s."deviceId", s."drivingSessionId",
         COALESCE(ds."truckId", a."truckId") AS "truckId",
         COALESCE(ds."startedAt", a."startedAt") AS "bindingStartedAt",
         COALESCE(ds."endedAt", a."endedAt") AS "bindingEndedAt",
         (e."recordedAt" < COALESCE(ds."startedAt", a."startedAt")
           OR (COALESCE(ds."endedAt", a."endedAt") IS NOT NULL AND e."recordedAt" > COALESCE(ds."endedAt", a."endedAt"))
         ) AS "outsideBindingInterval"
       FROM app.tracking_events e
       JOIN app.tracking_streams s ON s.id = e."streamId"
       LEFT JOIN app.device_truck_associations a ON a.id = s."associationId"
       LEFT JOIN app.driving_sessions ds ON ds.id = s."drivingSessionId"
       WHERE COALESCE(ds."truckId", a."truckId") = $1
         AND e."recordedAt" >= $2
         AND e."recordedAt" < $3
         AND e."receivedAt" <= $4
         AND ($5::timestamptz IS NULL OR (e."recordedAt", e.id) > ($5::timestamptz, $6::uuid))
       ORDER BY e."recordedAt", e.id
       LIMIT 1001`,
      [truckId, from, to, snapshot, afterTime, afterId],
    );

    const more = rows.length > 1000;
    const items = rows.slice(0, 1000);
    const last = items.at(-1);
    return {
      type: 'FeatureCollection',
      features: items
        .filter((e) => e.kind === 'location')
        .map((e) => ({
          type: 'Feature',
          id: e.id,
          geometry: { type: 'Point', coordinates: [e.longitude, e.latitude] },
          properties: { ...e, raw: e.raw },
        })),
      events: items,
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({
                truckId,
                from: from.toISOString(),
                to: to.toISOString(),
                snapshot: snapshot.toISOString(),
                at: new Date(last.recordedAt).toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
      snapshot: snapshot.toISOString(),
    };
  }
}
