import { createServer, type Server } from 'node:http';
import { Aedes, type Client } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import type { TelemetryService } from '../application/telemetry.service.js';

export class FleetMqttService {
  private broker?: Aedes;
  private server?: Server;
  private sockets?: WebSocketServer;
  private readonly identities = new WeakMap<
    Client,
    { deviceId: string; token: string }
  >();
  private readonly admins = new Map<
    Client,
    { userId: string; timer: ReturnType<typeof setTimeout> }
  >();
  private publishAttention?: () => void;

  constructor(
    private readonly telemetry: TelemetryService,
    private readonly events: OperationsEventsService,
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  async start() {
    if (process.env.MQTT_ENABLED !== 'true' || process.env.NODE_ENV === 'test') {
      return;
    }
    const broker = await Aedes.createBroker({
      connectTimeout: 10_000,
      queueLimit: 100,
      maxInflightInbound: 10,
      maxTopicLevels: 8,
      maxClientsIdLength: 120,
    });
    this.broker = broker;

    broker.authenticate = (client, username, password, done) => {
      const token = password?.toString() ?? '';
      if (username?.startsWith('admin:')) {
        void this.events
          .authenticate(token, username)
          .then((userId) => {
            if (!client.id.startsWith(`fleet-admin-${userId}-`)) {
              done(null, false);
              return;
            }
            const timer = setTimeout(() => client.close(), 120_000);
            timer.unref();
            this.admins.set(client, { userId, timer });
            done(null, true);
          })
          .catch(() => done(null, false));
        return;
      }
      void this.telemetry
        .device(token)
        .then((device) => {
          if (
            device.id !== username ||
            !client.id.startsWith(`fleet-${device.id}-`)
          ) {
            done(null, false);
            return;
          }
          this.identities.set(client, { deviceId: device.id, token });
          done(null, true);
        })
        .catch(() => done(null, false));
    };

    broker.authorizeSubscribe = (client, sub, done) => {
      const admin = this.admins.get(client);
      if (admin) {
        done(
          null,
          sub.topic === `fleet/admin/${admin.userId}/attention` && sub.qos <= 1
            ? sub
            : null,
        );
        return;
      }
      const identity = this.identities.get(client);
      done(
        null,
        identity &&
          sub.topic === `fleet/devices/${identity.deviceId}/receipts` &&
          sub.qos <= 1
          ? sub
          : null,
      );
    };

    broker.authorizeForward = (client, packet) => {
      const admin = this.admins.get(client);
      if (admin) {
        return packet.topic === `fleet/admin/${admin.userId}/attention`
          ? packet
          : null;
      }
      const identity = this.identities.get(client);
      return identity &&
        packet.topic === `fleet/devices/${identity.deviceId}/receipts`
        ? packet
        : null;
    };

    broker.authorizePublish = (client, packet, done) => {
      if (!client) {
        done(null);
        return;
      }
      const identity = this.identities.get(client);
      if (
        !identity ||
        packet.topic !== `fleet/devices/${identity.deviceId}/locations` ||
        packet.retain ||
        packet.qos !== 1 ||
        packet.payload.length > 131_072
      ) {
        done(new Error('Publish denied.'));
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(packet.payload.toString());
      } catch {
        done(new Error('Invalid payload.'));
        return;
      }
      void this.telemetry
        .ingest(identity.token, body)
        .then((receipt) => {
          done(null);
          // MQTT PUBACK alone is not a durable database receipt. Only this message retires the outbox.
          broker.publish(
            {
              cmd: 'publish',
              qos: 1,
              retain: false,
              dup: false,
              topic: `fleet/devices/${identity.deviceId}/receipts`,
              payload: Buffer.from(JSON.stringify(receipt)),
            },
            () => undefined,
          );
        })
        .catch(() => {
          done(new Error('Tracking batch was not committed.'));
          client.close();
        });
    };

    this.publishAttention = () => {
      for (const topic of new Set(
        [...this.admins.values()].map(
          (a) => `fleet/admin/${a.userId}/attention`,
        ),
      )) {
        broker.publish(
          {
            cmd: 'publish',
            qos: 1,
            retain: false,
            dup: false,
            topic,
            payload: Buffer.from('{"type":"attention.changed"}'),
          },
          () => undefined,
        );
      }
    };
    this.events.changes.on('changed', this.publishAttention);

    broker.on('clientDisconnect', (client) => {
      const admin = this.admins.get(client);
      if (admin) clearTimeout(admin.timer);
      this.admins.delete(client);
    });
    broker.on('clientError', () => undefined);
    broker.on('connectionError', () => undefined);

    const server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    this.server = server;

    const sockets = new WebSocketServer({
      server,
      path: '/mqtt',
      maxPayload: 131_072,
      perMessageDeflate: false,
    });
    this.sockets = sockets;
    sockets.on('connection', (socket) => {
      socket.on('error', () => undefined);
      const stream = createWebSocketStream(socket);
      stream.on('error', () => undefined);
      broker.handle(stream);
    });

    const port = Number(process.env.MQTT_WS_PORT ?? 1884);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('Invalid MQTT_WS_PORT');
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, process.env.MQTT_BIND_HOST ?? '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.logger.info(
      `Device MQTT WebSocket transport listening on port ${port}`,
    );
  }

  async stop() {
    if (this.publishAttention) {
      this.events.changes.off('changed', this.publishAttention);
    }
    for (const admin of this.admins.values()) clearTimeout(admin.timer);
    this.admins.clear();
    for (const socket of this.sockets?.clients ?? []) socket.terminate();
    await new Promise<void>((resolve) =>
      this.broker ? this.broker.close(() => resolve()) : resolve(),
    );
    this.sockets?.close();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
