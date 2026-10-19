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
import type { AdminContext } from '../auth/auth.service.js';
import { TruckDevice } from '../fleet/fleet.entity.js';
import {
  MobileDeviceService,
  hashDeviceToken,
} from '../mobile/mobile-device.service.js';
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
    @Inject(MobileDeviceService) private readonly devices: MobileDeviceService,
  ) {}
  async device(token: string) {
    const d = await this.db
      .getRepository(TruckDevice)
      .findOneBy({ credentialHash: hashDeviceToken(token) });
    if (!d)
      throw new UnauthorizedException(
        'Device access has ended. Ask an administrator to set up this device.',
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
  async start(context: AdminContext, token: string, input: unknown) {
    const v = input as Record<string, unknown>;
    if (!v || Object.keys(v).some((k) => k !== 'streamId'))
      throw new BadRequestException('Invalid tracking start.');
    const id = uuid(v.streamId);
    return this.db.transaction(async (m) => {
      await m.query('SET LOCAL synchronous_commit = on');
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const state = await this.devices.driverContext(context, token);
      if (
        !state.canConfirm ||
        !state.confirmedAt ||
        !state.truck ||
        !state.associationId
      )
        throw new ForbiddenException(
          'Confirm your truck before sharing location.',
        );
      const repo = m.getRepository(TrackingStream),
        existing = await repo.findOneBy({ id });
      if (existing) {
        if (
          existing.deviceId !== state.device.id ||
          existing.driverId !== state.driver.id ||
          existing.kratosSessionId !== context.session.id ||
          existing.endedAt
        )
          throw new ConflictException('Start a new location sharing session.');
        return existing;
      }
      await repo.update(
        { deviceId: state.device.id, endedAt: IsNull() },
        { endedAt: new Date() },
      );
      return repo.save(
        repo.create({
          id,
          deviceId: state.device.id,
          driverId: state.driver.id,
          associationId: state.associationId,
          kratosSessionId: context.session.id,
          endedAt: null,
          finalSequence: null,
        }),
      );
    });
  }
  async ingest(token: string, input: unknown) {
    const batch = parseBatch(input),
      credentialHash = hashDeviceToken(token);
    // This transaction commits before a business receipt is returned by HTTP or MQTT.
    return this.db.transaction(async (m) => {
      await m.query('SET LOCAL synchronous_commit = on');
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `tracking:${batch.streamId}`,
      ]);
      const device = await m.findOneBy(TruckDevice, { credentialHash });
      if (!device) throw new UnauthorizedException('Device access has ended.');
      const stream = await m.findOneBy(TrackingStream, {
        id: batch.streamId,
        deviceId: device.id,
      });
      if (!stream) throw new NotFoundException('Tracking session not found.');
      const access = (
        await m.query(
          `SELECT EXISTS(SELECT 1 FROM app.driver_profiles p JOIN app.users u ON u.id=p."userId"
        JOIN app.device_truck_associations a ON a.id=$2 JOIN app.trucks t ON t.id=a."truckId"
        WHERE p.id=$1 AND p.status='active' AND u."isActive" AND a."endedAt" IS NULL AND t.status='active'
        AND p."licenceExpiresOn">=CURRENT_DATE AND p."prdpExpiresOn">=CURRENT_DATE AND p."prdpNumber" IS NOT NULL
        AND EXISTS(SELECT 1 FROM app.user_roles ur JOIN app.role_permissions rp ON rp."roleId"=ur."roleId" JOIN app.permissions pm ON pm.id=rp."permissionId" WHERE ur."userId"=u.id AND pm.key='driver.access')) AS allowed`,
          [stream.driverId, stream.associationId],
        )
      )[0].allowed;
      const captureAllowed = !!access && !stream.endedAt;
      if (!captureAllowed && !stream.endedAt) {
        stream.endedAt = new Date();
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
          `INSERT INTO app.tracking_events (id,"streamId",sequence,kind,"recordedAt",latitude,longitude,accuracy,speed,heading,mocked,digest,raw) VALUES ${inserts.map((row, i) => '(' + row.map((_, j) => '$' + (i * 13 + j + 1)).join(',') + ')').join(',')}`,
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
      `SELECT s.*,p.identifier AS "driverIdentifier",d.identifier AS "deviceIdentifier",a."truckId",
      (SELECT count(*)::int FROM app.tracking_events e WHERE e."streamId"=s.id) AS "receivedCount",
      (SELECT MAX(e."recordedAt") FROM app.tracking_events e WHERE e."streamId"=s.id AND e.kind='location') AS "lastFixAt"
      FROM app.tracking_streams s JOIN app.device_truck_associations a ON a.id=s."associationId" JOIN app.driver_profiles p ON p.id=s."driverId" JOIN app.truck_devices d ON d.id=s."deviceId" WHERE a."truckId"=$1 ORDER BY s."startedAt" DESC LIMIT 100`,
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
    FROM app.tracking_events e JOIN app.tracking_streams s ON s.id=e."streamId" JOIN app.device_truck_associations a ON a.id=s."associationId" JOIN app.trucks t ON t.id=a."truckId" JOIN app.driver_profiles p ON p.id=s."driverId" WHERE e.kind='location' AND (a."endedAt" IS NULL OR e."recordedAt"<a."endedAt") ORDER BY t.id,e."recordedAt" DESC,e.id DESC`);
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
      `SELECT e.*,s."driverId",s."deviceId",a."truckId",a."startedAt" AS "bindingStartedAt",a."endedAt" AS "bindingEndedAt",(e."recordedAt"<a."startedAt" OR (a."endedAt" IS NOT NULL AND e."recordedAt">=a."endedAt")) AS "outsideBindingInterval" FROM app.tracking_events e JOIN app.tracking_streams s ON s.id=e."streamId" JOIN app.device_truck_associations a ON a.id=s."associationId" WHERE a."truckId"=$1 AND e."recordedAt">=$2 AND e."recordedAt"<$3 AND e."receivedAt"<=$4 AND ($5::timestamptz IS NULL OR (e."recordedAt",e.id)>($5::timestamptz,$6::uuid)) ORDER BY e."recordedAt",e.id LIMIT 1001`,
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
