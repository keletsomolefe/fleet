import { useEffect, useState } from "react";
import type { MqttClient } from "mqtt";
import { Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AdminSession } from "@/lib/auth";

type Snapshot = {
  count: number;
  latest: Array<{
    id: string;
    kind: string;
    registration: string;
    driverName: string;
    createdAt: string;
  }>;
};
type Connection = {
  mqttUrl: string | null;
  username: string;
  password: string;
  topic: string;
  clientPrefix: string;
};
export function AttentionMenu({ session }: { session: AdminSession }) {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState("");
  const allowed = ["admin.access", "trucks.read", "trucks.write"].every((p) =>
    session.permissions.includes(p),
  );
  useEffect(() => {
    if (!allowed) return;
    let alive = true,
      busy = false,
      pending = false,
      pendingInvalidate = false,
      connecting = false,
      socket: MqttClient | undefined;
    async function refresh(invalidate = false) {
      if (busy) {
        pending = true;
        pendingInvalidate ||= invalidate;
        return;
      }
      busy = true;
      try {
        const r = await fetch("/api/admin/notifications", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) throw new Error();
        const next = (await r.json()) as Snapshot;
        if (alive) {
          setData(next);
          setError("");
          if (invalidate)
            window.dispatchEvent(new Event("fleet:attention-changed"));
        }
      } catch {
        if (alive) setError("Could not refresh items. Try again.");
      } finally {
        busy = false;
        if (pending && alive) {
          const nextInvalidate = pendingInvalidate;
          pending = false;
          pendingInvalidate = false;
          void refresh(nextInvalidate);
        }
      }
    }
    async function connect() {
      if (connecting || socket?.connected) return;
      connecting = true;
      try {
        const r = await fetch("/api/admin/notifications/connection", {
          method: "POST",
          headers: { "X-CSRF-Token": session.csrfToken },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) throw new Error();
        const cfg = (await r.json()) as Connection;
        if (!cfg.mqttUrl || !alive) return;
        const { default: mqtt } = await import("mqtt");
        if (!alive) return;
        socket?.end(true);
        const client = mqtt.connect(cfg.mqttUrl, {
          username: cfg.username,
          password: cfg.password,
          clientId: cfg.clientPrefix + crypto.randomUUID().slice(0, 8),
          protocolVersion: 4,
          clean: true,
          reconnectPeriod: 0,
          connectTimeout: 8000,
          keepalive: 30,
        });
        socket = client;
        client.on("connect", () =>
          client.subscribe(cfg.topic, { qos: 1 }, (err) => {
            if (!err) void refresh();
          }),
        );
        client.on("message", () => void refresh(true));
        client.on("error", () => undefined);
      } catch {
        /* The HTTP snapshot also recovers missed notifications. */
      } finally {
        connecting = false;
      }
    }
    const update = () => {
      void refresh();
      void connect();
    };
    update();
    const timer = setInterval(update, 20000);
    window.addEventListener("focus", update);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", update);
      socket?.end(true);
    };
  }, [allowed, session.csrfToken]);
  if (!allowed) return null;
  return (
    <details
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.open = false;
      }}
    >
      <summary
        className="relative flex size-10 cursor-pointer list-none items-center justify-center rounded-full border focus-visible:outline-2"
        aria-label={
          data ? `${data.count} items to resolve` : "Items to resolve"
        }
      >
        <Bell className="size-5" />
        {!!data?.count && (
          <span
            role="status"
            className="absolute -top-1 -right-1 min-w-5 rounded-full bg-destructive px-1 text-center text-[10px] leading-5 font-semibold text-white"
          >
            {data.count > 99 ? "99+" : data.count}
          </span>
        )}
      </summary>
      <Card className="absolute right-0 z-50 mt-3 max-h-[70vh] w-[min(360px,90vw)] gap-0 overflow-auto p-4 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold">
          Needs attention{data ? ` (${data.count})` : ""}
        </h2>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {!data && !error && <p className="text-xs">Loading…</p>}
        {data?.count === 0 && (
          <p className="text-xs text-muted-foreground">Nothing to resolve.</p>
        )}
        {data?.latest.map((item) => (
          <Link
            key={item.id}
            to="/admin/vehicle-disputes"
            className="space-y-1 border-b py-3 text-xs"
            onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <p className="font-semibold">
              {item.kind === "schedule"
                ? "Schedule mismatch"
                : "Vehicle in use"}{" "}
              · {item.registration}
            </p>
            <p className="text-muted-foreground">{item.driverName}</p>
          </Link>
        ))}
        <Button asChild variant="outline" className="mt-4">
          <Link to="/admin/vehicle-disputes">Review items</Link>
        </Button>
      </Card>
    </details>
  );
}
