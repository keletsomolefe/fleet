import { useCallback, useEffect, useState, useRef } from "react";
import { AppState, Platform } from "react-native";
import mqtt, { type MqttClient } from "mqtt";
import * as Crypto from "expo-crypto";
import { request, type Session } from "./api";
export type Attention = {
  count: number;
  latest: {
    id: string;
    kind: string;
    registration: string;
    driverName: string;
    createdAt: string;
  }[];
  version: number;
  error: string;
};
export function useAttention(session: Session | null) {
  const [value, setValue] = useState<Attention>({
    count: 0,
    latest: [],
    version: 0,
    error: "",
  });
  const enabled =
    !!session &&
    ["admin.access", "trucks.read", "trucks.write"].every((p) =>
      session.permissions.includes(p),
    );
  const token = enabled ? session?.sessionToken : undefined;
  const currentToken = useRef(token),
    sequence = useRef(0);
  useEffect(() => {
    currentToken.current = token;
    sequence.current++;
  }, [token]);
  const refresh = useCallback(async () => {
    if (!token) return;
    const ticket = ++sequence.current;
    try {
      const data = await request<Omit<Attention, "version" | "error">>(
        "admin/notifications",
        { session: token },
      );
      if (currentToken.current !== token || ticket !== sequence.current) return;
      setValue((v) => ({ ...data, error: "", version: v.version + 1 }));
    } catch {
      if (currentToken.current !== token || ticket !== sequence.current) return;
      setValue((v) => ({ ...v, error: "Could not refresh items. Try again." }));
    }
  }, [token]);
  useEffect(() => {
    if (!token || Platform.OS === "web") return;
    let alive = true,
      connecting = false,
      socket: MqttClient | undefined;
    async function connect() {
      if (connecting || socket?.connected || !alive) return;
      connecting = true;
      try {
        const cfg = await request<{
          mqttUrl: string | null;
          username: string;
          password: string;
          topic: string;
          clientPrefix: string;
        }>("admin/notifications/connection", {
          method: "POST",
          session: token,
        });
        if (!cfg.mqttUrl || !alive) return;
        socket?.end(true);
        const client = mqtt.connect(cfg.mqttUrl, {
          username: cfg.username,
          password: cfg.password,
          clientId: cfg.clientPrefix + Crypto.randomUUID().slice(0, 8),
          protocolVersion: 4,
          clean: true,
          reconnectPeriod: 0,
          connectTimeout: 8000,
          keepalive: 30,
          forceNativeWebSocket: true,
        });
        socket = client;
        client.on("connect", () =>
          client.subscribe(cfg.topic, { qos: 1 }, (err) => {
            if (!err && alive) void refresh();
          }),
        );
        client.on("message", () => {
          if (alive) void refresh();
        });
        client.on("error", () => undefined);
      } catch {
        /* HTTP refresh recovers missed notifications. */
      } finally {
        connecting = false;
      }
    }
    const update = () => {
      if (AppState.currentState === "active") {
        void refresh();
        void connect();
      }
    };
    update();
    const timer = setInterval(update, 20000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") update();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
      socket?.end(true);
    };
  }, [token, refresh]);
  return {
    attention: enabled
      ? value
      : { count: 0, latest: [], version: 0, error: "" },
    refreshAttention: refresh,
  };
}
