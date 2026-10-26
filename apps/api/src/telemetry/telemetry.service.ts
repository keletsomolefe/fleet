import { today } from '../scheduling/schedule.input.js';
import { DriverSchedule } from '../scheduling/schedule.entity.js';
import { VehicleDispute } from '../mobile/driving.entity.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { DrivingService } from '../mobile/driving.service.js';
import { DrivingSession } from '../mobile/driving.entity.js';
import type { AdminContext } from '../auth/auth.service.js';
import {
  KratosError,
  KratosService,
  type KratosSession,
} from '../auth/kratos.service.js';
import { TruckDevice } from '../fleet/fleet.entity.js';
import { hashDeviceToken } from '../mobile/mobile-device.service.js';
import { TrackingEvent, TrackingStream } from './telemetry.entity.js';
import {
  digest,
  instant,
  missingRanges,
  parseBatch,
  parseSample,
  uuid,
} from './telemetry.input.js';

@Injectable()
export class TelemetryService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(DrivingService) private readonly driving: DrivingService,
    @Inject(KratosService) private readonly kratos: KratosService,
  ) {}
  async device(token: string) {
    const personal = await this.db
      .getRepository(TrackingStream)
      .findOneBy({ uploadTokenHash: hashDeviceToken(token) });
    if (personal) return { id: personal.id };
    const d = await this.db
      .getRepository(TruckDevice)
      .findOneBy({ credentialHash: hashDeviceToken(token) });
    if (!d)
      throw new UnauthorizedException(
        'Location sharing access has ended. Start sharing again.',
      );
    return d;
  }
  async config(token: string) {
    const d = await this.device(token);
    const url = process.env.MQTT_PUBLIC_URL ?? 'ws://127.0.0.1:1884/mqtt';
    if (process.env.NODE_ENV === 'production' && !url.startsWith('wss://'))
      throw new BadRequestException('Secure MQTT transport is not configured.');
    return {
      deviceId: d.id,
      mqttUrl: process.env.MQTT_ENABLED === 'true' ? url : null,
      sampleIntervalMs: 10000,
      batchSize: 100,
    };
  }
  async start(context: AdminContext, input: unknown) {
    const v = input as Record<string, unknown>;
    if (
      !v ||
      Object.keys(v).some(
        (k) => !['streamId', 'drivingSessionId', 'uploadToken'].includes(k),
      )
    )
      throw new BadRequestException('Invalid tracking start.');
    const id = uuid(v.streamId);
    const drivingSessionId = uuid(v.drivingSessionId);
    const uploadTokenHash = hashDeviceToken(
      typeof v.uploadToken === 'string' ? v.uploadToken : '',
    );
    return this.db.transaction(async (m) => {
      await m.query('SET LOCAL synchronous_commit = on');
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const state = await this.driving.context(context, m);
      if (
        !state.canDrive ||
        !state.confirmedAt ||
        !state.truck ||
        !state.drivingSession?.onThisPhone ||
        state.drivingSession.id !== drivingSessionId
      )
        throw new ForbiddenException(
          'Confirm your truck before sharing location.',
        );
      const repo = m.getRepository(TrackingStream),
        existing = await repo.findOneBy({ id });
      if (existing) {
        if (
          existing.drivingSessionId !== drivingSessionId ||
          existing.driverId !== state.driver.id ||
          existing.kratosSessionId !== context.session.id ||
          existing.endedAt ||
          (
            await repo
              .createQueryBuilder('s')
              .addSelect('s.uploadTokenHash')
              .where('s.id=:id', { id })
              .getOne()
          )?.uploadTokenHash !== uploadTokenHash
        )
          throw new ConflictException('Start a new location sharing session.');
        return {
          id: existing.id,
          deviceId: existing.id,
          driverId: existing.driverId,
          associationId: drivingSessionId,
          startedAt: existing.startedAt,
        };
      }
      const startedAt: Date = (
        await m.query('SELECT clock_timestamp() AS at')
      )[0].at;
      await repo.update(
        { drivingSessionId, endedAt: IsNull() },
        { endedAt: startedAt },
      );
      const stream = await repo.save(
        repo.create({
          id,
          deviceId: null,
          driverId: state.driver.id,
          associationId: null,
          drivingSessionId,
          uploadTokenHash,
          kratosSessionId: context.session.id,
          startedAt,
          endedAt: null,
          finalSequence: null,
        }),
      );
      return {
        id: stream.id,
        deviceId: stream.id,
        driverId: stream.driverId,
        associationId: drivingSessionId,
        startedAt: stream.startedAt,
      };
    });
  }
  async ingest(token: string, input: unknown) {
    const batch = parseBatch(input),
      credentialHash = hashDeviceToken(token);
    const candidate = await this.db
      .getRepository(TrackingStream)
      .findOneBy({ id: batch.streamId, uploadTokenHash: credentialHash });
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
          !!session.identity &&
          session.identity.state !== 'inactive';
        sessionEndsAt = session.expires_at
          ? new Date(session.expires_at)
          : null;
        if (sessionEndsAt && sessionEndsAt <= new Date()) validSession = false;
      } catch (error) {
        if (
          error instanceof KratosError &&
          [401, 403, 404].includes(error.status)
        )
          validSession = false;
        else throw error;
      }
    }
    // This transaction commits before a business receipt is returned by HTTP or MQTT.
    return this.db.transaction(async (m) => {
      await m.query('SET LOCAL synchronous_commit = on');
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `tracking:${batch.streamId}`,
      ]);
      const personal = await m.findOneBy(TrackingStream, {
        id: batch.streamId,
        uploadTokenHash: credentialHash,
      });
      const device = personal
        ? null
        : await m.findOneBy(TruckDevice, { credentialHash });
      if (!personal && !device)
        throw new UnauthorizedException('Location sharing access has ended.');
      const stream =
        personal ??
        (await m.findOneBy(TrackingStream, {
          id: batch.streamId,
          deviceId: device!.id,
        }));
      if (!stream) throw new NotFoundException('Tracking session not found.');
      const drive = stream.drivingSessionId
        ? await m.findOneBy(DrivingSession, { id: stream.drivingSessionId })
        : null;
      const access = (
        await m.query(
          `SELECT EXISTS(SELECT 1 FROM app.driver_profiles p JOIN app.users u ON u.id=p."userId"
        JOIN app.trucks t ON t.id=COALESCE((SELECT "truckId" FROM app.driving_sessions WHERE id=$3),(SELECT "truckId" FROM app.device_truck_associations WHERE id=$2))
        WHERE p.id=$1 AND p.status='active' AND u."isActive" AND t.status='active'
        AND p."licenceExpiresOn">=(now() AT TIME ZONE 'Africa/Johannesburg')::date AND p."prdpExpiresOn">=(now() AT TIME ZONE 'Africa/Johannesburg')::date AND p."prdpNumber" IS NOT NULL
        AND EXISTS(SELECT 1 FROM app.user_roles ur JOIN app.role_permissions rp ON rp."roleId"=ur."roleId" JOIN app.permissions pm ON pm.id=rp."permissionId" WHERE ur."userId"=u.id AND pm.key='driver.access')) AS allowed`,
          [stream.driverId, stream.associationId, stream.drivingSessionId],
        )
      )[0].allowed;
      const schedule = drive
        ? await m.findOneBy(DriverSchedule, {
            driverId: drive.driverId,
            date: today(),
            cancelledAt: IsNull(),
          })
        : null;
      const dayEndsAt = drive
        ? new Date(
            Date.parse(drive.confirmedDate + 'T00:00:00Z') + 22 * 3600000,
          )
        : null;
      if (
        dayEndsAt &&
        dayEndsAt <= new Date() &&
        (!stream.endedAt || dayEndsAt < stream.endedAt)
      ) {
        stream.endedAt = dayEndsAt;
        await m.save(stream);
      }
      const scheduleAllowed =
        !!drive &&
        drive.confirmedDate === today() &&
        (drive.scheduleId ?? null) === (schedule?.id ?? null) &&
        !(await m.existsBy(VehicleDispute, {
          driverId: drive.driverId,
          kind: 'schedule',
          scheduleDate: today(),
          resolvedAt: IsNull(),
        }));
      const captureAllowed =
        scheduleAllowed &&
        !!access &&
        validSession &&
        !stream.endedAt &&
        !!drive &&
        !drive.endedAt;
      if (
        drive?.endedAt &&
        (!stream.endedAt || drive.endedAt < stream.endedAt)
      ) {
        stream.endedAt = drive.endedAt;
        await m.save(stream);
      }
      if (!captureAllowed && !stream.endedAt) {
        stream.endedAt =
          sessionEndsAt && sessionEndsAt < new Date()
            ? sessionEndsAt
            : new Date();
        await m.save(stream);
      }
      const acceptedIds: string[] = [],
        rejected: Array<{ eventId: string; reason: string }> = [];
      const parsed: ReturnType<typeof parseSample>[] = [];
      for (const raw of batch.events) {
        let id: string;
        try {
          id = uuid((raw as { eventId?: unknown })?.eventId);
        } catch {
          throw new BadRequestException(
            'A tracking record has no valid identifier.',
          );
        }
        try {
          parsed.push(parseSample(raw));
        } catch (error) {
          rejected.push({
            eventId: id,
            reason:
              error instanceof Error
                ? error.message
                : 'Invalid tracking record.',
          });
        }
      }
      const existing = parsed.length
        ? await m.getRepository(TrackingEvent).find({
            where: [
              { id: In(parsed.map((p) => p.eventId)) },
              {
                streamId: stream.id,
                sequence: In(parsed.map((p) => p.sequence)),
              },
            ],
          })
        : [];
      const byId = new Map(existing.map((e) => [e.id, e])),
        bySequence = new Map(
          existing
            .filter((e) => e.streamId === stream.id)
            .map((e) => [e.sequence, e]),
        );
      const inserts: unknown[][] = [];
      for (const sample of parsed) {
        const id = sample.eventId,
          hash = digest(sample),
          duplicate = byId.get(id) ?? bySequence.get(sample.sequence);
        if (duplicate) {
          if (
            duplicate.id === id &&
            duplicate.streamId === stream.id &&
            duplicate.digest === hash
          )
            acceptedIds.push(id);
          else
            rejected.push({
              eventId: id,
              reason:
                'Record identifier or sequence conflicts with stored history.',
            });
          continue;
        }
        const recorded = instant(sample.recordedAt);
        if (
          recorded < stream.startedAt ||
          (!stream.drivingSessionId && stream.endedAt && recorded > stream.endedAt)
        ) {
          rejected.push({
            eventId: id,
            reason:
              'Record is outside this driving session. Retained for review.',
          });
          continue;
        }
        const c =
          sample.kind === 'location'
            ? (sample.data.coords as Record<string, number | null>)
            : null;
        inserts.push([
          id,
          stream.id,
          sample.sequence,
          sample.kind,
          instant(sample.recordedAt),
          c?.latitude ?? null,
          c?.longitude ?? null,
          c?.accuracy ?? null,
          c?.speed ?? null,
          c?.heading ?? null,
          typeof sample.data.mocked === 'boolean' ? sample.data.mocked : null,
          hash,
          JSON.stringify(sample.data),
          !!(stream.endedAt && recorded > stream.endedAt),
        ]);
        const record = Object.assign(new TrackingEvent(), {
          id,
          streamId: stream.id,
          sequence: sample.sequence,
          digest: hash,
        });
        byId.set(id, record);
        bySequence.set(sample.sequence, record);
        acceptedIds.push(id);
      }
      if (inserts.length)
        await m.query(
          `INSERT INTO app.tracking_events (id,"streamId",sequence,kind,"recordedAt",latitude,longitude,accuracy,speed,heading,mocked,digest,raw,unconfirmed) VALUES ${inserts.map((row, i) => '(' + row.map((_, j) => '$' + (i * 14 + j + 1)).join(',') + ')').join(',')}`,
          inserts.flat(),
        );
      if (batch.end) {
        const maximum = Number(
          (
            await m.query(
              'SELECT COALESCE(MAX(sequence),0) AS n FROM app.tracking_events WHERE "streamId"=$1',
              [stream.id],
            )
          )[0].n,
        );
        if (
          batch.end.finalSequence < maximum ||
          (stream.finalSequence !== null &&
            batch.end.finalSequence < stream.finalSequence)
        )
          throw new ConflictException(
            'Tracking close sequence is behind stored history.',
          );
        if (batch.end.at.getTime() < stream.startedAt.getTime() - 300000)
          throw new BadRequestException(
            'Tracking close time is before the session.',
          );
        stream.endedAt =
          stream.endedAt && stream.endedAt < batch.end.at
            ? stream.endedAt
            : batch.end.at;
        stream.finalSequence = batch.end.finalSequence;
        await m.save(stream);
      }
      return {
        batchId: batch.batchId,
        streamId: stream.id,
        acceptedIds,
        rejected,
        captureAllowed: captureAllowed && !batch.end,
        closed: !!batch.end,
        receivedAt: new Date().toISOString(),
      };
    });
  }
  async streams(truckId: string) {
    return this.db.query(
      `SELECT s.id,s."deviceId",s."driverId",s."associationId",s."drivingSessionId",s."startedAt",s."endedAt",s."finalSequence",p.identifier AS "driverIdentifier",COALESCE(d.identifier,'Personal phone') AS "deviceIdentifier",COALESCE(ds."truckId",a."truckId") AS "truckId",
      (SELECT count(*)::int FROM app.tracking_events e WHERE e."streamId"=s.id) AS "receivedCount",
      (SELECT MAX(e."recordedAt") FROM app.tracking_events e WHERE e."streamId"=s.id AND e.kind='location') AS "lastFixAt"
      FROM app.tracking_streams s LEFT JOIN app.device_truck_associations a ON a.id=s."associationId" LEFT JOIN app.driving_sessions ds ON ds.id=s."drivingSessionId" JOIN app.driver_profiles p ON p.id=s."driverId" LEFT JOIN app.truck_devices d ON d.id=s."deviceId" WHERE COALESCE(ds."truckId",a."truckId")=$1 ORDER BY s."startedAt" DESC LIMIT 100`,
      [uuid(truckId)],
    );
  }
  async integrity(streamId: string) {
    const s = await this.db
      .getRepository(TrackingStream)
      .findOneBy({ id: uuid(streamId) });
    if (!s) throw new NotFoundException('Tracking session not found.');
    const rows = await this.db.query(
      'SELECT sequence FROM app.tracking_events WHERE "streamId"=$1 ORDER BY sequence',
      [s.id],
    );
    const ranges = missingRanges(
      rows.map((r: { sequence: number }) => r.sequence),
      s.finalSequence,
    );
    return {
      stream: s,
      receivedCount: rows.length,
      missingRanges: ranges,
      complete:
        s.finalSequence !== null &&
        rows.length === s.finalSequence &&
        !ranges.length,
    };
  }
  async latest() {
    return this.db
      .query(`SELECT DISTINCT ON (t.id) t.id AS "truckId",t.identifier,t.registration,p.identifier AS "driverIdentifier",e."recordedAt",e."receivedAt",e.latitude,e.longitude,e.accuracy,e.speed,e.heading,e.mocked,s."endedAt",s.id AS "streamId",(e."recordedAt" < now()-interval '2 minutes') AS stale
    FROM app.tracking_events e JOIN app.tracking_streams s ON s.id=e."streamId" LEFT JOIN app.device_truck_associations a ON a.id=s."associationId" LEFT JOIN app.driving_sessions ds ON ds.id=s."drivingSessionId" JOIN app.trucks t ON t.id=COALESCE(ds."truckId",a."truckId") JOIN app.driver_profiles p ON p.id=s."driverId" WHERE e.kind='location' AND e.unconfirmed=false AND (COALESCE(ds."endedAt",a."endedAt") IS NULL OR e."recordedAt"<=COALESCE(ds."endedAt",a."endedAt")) ORDER BY t.id,e."recordedAt" DESC,e.id DESC`);
  }
  async history(
    truckId: string,
    fromValue?: string,
    toValue?: string,
    cursor?: string,
  ) {
    uuid(truckId);
    const from = instant(fromValue),
      to = instant(toValue);
    if (to <= from || to.getTime() - from.getTime() > 31 * 86400000)
      throw new BadRequestException('Select a history range of up to 31 days.');
    let snapshot = new Date(),
      afterTime: Date | null = null,
      afterId: string | null = null;
    if (cursor) {
      if (cursor.length > 600)
        throw new BadRequestException('Invalid history cursor.');
      try {
        const c = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (
          c.truckId !== truckId ||
          c.from !== from.toISOString() ||
          c.to !== to.toISOString()
        )
          throw new Error();
        snapshot = instant(c.snapshot);
        afterTime = instant(c.at);
        afterId = uuid(c.id);
      } catch {
        throw new BadRequestException('Invalid history cursor.');
      }
    }
    const rows = await this.db.query(
      `SELECT e.*,s."driverId",s."deviceId",s."drivingSessionId",COALESCE(ds."truckId",a."truckId") AS "truckId",COALESCE(ds."startedAt",a."startedAt") AS "bindingStartedAt",COALESCE(ds."endedAt",a."endedAt") AS "bindingEndedAt",(e."recordedAt"<COALESCE(ds."startedAt",a."startedAt") OR (COALESCE(ds."endedAt",a."endedAt") IS NOT NULL AND e."recordedAt">COALESCE(ds."endedAt",a."endedAt"))) AS "outsideBindingInterval" FROM app.tracking_events e JOIN app.tracking_streams s ON s.id=e."streamId" LEFT JOIN app.device_truck_associations a ON a.id=s."associationId" LEFT JOIN app.driving_sessions ds ON ds.id=s."drivingSessionId" WHERE COALESCE(ds."truckId",a."truckId")=$1 AND e."recordedAt">=$2 AND e."recordedAt"<$3 AND e."receivedAt"<=$4 AND ($5::timestamptz IS NULL OR (e."recordedAt",e.id)>($5::timestamptz,$6::uuid)) ORDER BY e."recordedAt",e.id LIMIT 1001`,
      [truckId, from, to, snapshot, afterTime, afterId],
    );
    const more = rows.length > 1000,
      items = rows.slice(0, 1000),
      last = items.at(-1);
    return {
      type: 'FeatureCollection',
      features: items
        .filter((e: TrackingEvent) => e.kind === 'location')
        .map((e: TrackingEvent) => ({
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
