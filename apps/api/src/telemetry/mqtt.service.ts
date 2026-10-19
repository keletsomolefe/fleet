import { createServer, type Server } from 'node:http';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Aedes, type Client } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';
import { TelemetryService } from './telemetry.service.js';

@Injectable()
export class FleetMqttService implements OnModuleInit, OnModuleDestroy {
  private broker?: Aedes;
  private server?: Server;
  private sockets?: WebSocketServer;
  private readonly identities = new WeakMap<
    Client,
    { deviceId: string; token: string }
  >();
  private readonly logger = new Logger(FleetMqttService.name);
  constructor(
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
  ) {}
  async onModuleInit() {
    if (process.env.MQTT_ENABLED !== 'true' || process.env.NODE_ENV === 'test')
      return;
    const broker = await Aedes.createBroker({
      connectTimeout: 10000,
      queueLimit: 100,
      maxInflightInbound: 10,
      maxTopicLevels: 8,
      maxClientsIdLength: 120,
    });
    this.broker = broker;
    broker.authenticate = (client, username, password, done) => {
      const token = password?.toString() ?? '';
      void this.telemetry
        .device(token)
        .then((d) => {
          if (d.id !== username || !client.id.startsWith(`fleet-${d.id}-`)) {
            done(null, false);
            return;
          }
          this.identities.set(client, { deviceId: d.id, token });
          done(null, true);
        })
        .catch(() => done(null, false));
    };
    broker.authorizeSubscribe = (client, sub, done) => {
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
        packet.payload.length > 131072
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
      maxPayload: 131072,
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
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Invalid MQTT_WS_PORT');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, process.env.MQTT_BIND_HOST ?? '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.logger.log(
      `Device MQTT WebSocket transport listening on port ${port}`,
    );
  }
  async onModuleDestroy() {
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
