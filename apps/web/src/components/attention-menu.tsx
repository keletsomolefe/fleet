import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminNotificationsKey,
  adminOperationsKey,
  refreshAdminOperations,
} from "@/lib/admin-queries";
import type { MqttClient } from "mqtt";
import { Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AdminSession } from "@/lib/auth";
import { issueLabels } from "@/lib/vehicle-disputes";

type Snapshot = {
  count: number;
  latest: Array<{
    id: string;
    kind: string;
    registration: string | null;
    category: keyof typeof issueLabels | null;
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
  const userId = session.user.id;
  const queryClient = useQueryClient();
  const allowed =
    session.permissions.includes("admin.access") &&
    (session.permissions.includes("issues.read") ||
      ["trucks.read", "trucks.write"].every((p) =>
        session.permissions.includes(p),
      ));
  const { data, isError } = useQuery({
    queryKey: adminNotificationsKey(userId),
    enabled: allowed,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    queryFn: async ({ signal }): Promise<Snapshot> => {
      const response = await fetch("/api/admin/notifications", {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw new Error("Could not refresh items. Try again.");
      return response.json();
    },
  });

  // If a socket message was missed, a changed HTTP snapshot still updates the lists.
  const previous = useRef<{ userId: string; data: Snapshot } | null>(null);
  useEffect(() => {
    if (!allowed || !data) {
      previous.current = null;
      return;
    }
    if (previous.current?.userId === userId && previous.current.data !== data)
      void queryClient.invalidateQueries(
        { queryKey: adminOperationsKey(userId) },
        { cancelRefetch: false },
      );
    previous.current = { userId, data };
  }, [allowed, data, queryClient, userId]);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const refresh = () => {
      if (!controller.signal.aborted)
        void refreshAdminOperations(queryClient, userId);
    };
    let connecting = false;
    let socket: MqttClient | undefined;
    async function connect() {
      if (connecting || socket?.connected) return;
      connecting = true;
      try {
        const r = await fetch("/api/admin/notifications/connection", {
          method: "POST",
          headers: { "X-CSRF-Token": session.csrfToken },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        if (!r.ok) throw new Error();
        const cfg = (await r.json()) as Connection;
        if (!cfg.mqttUrl || controller.signal.aborted) return;
        const { default: mqtt } = await import("mqtt");
        if (controller.signal.aborted) return;
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
            if (!err) refresh();
          }),
        );
        client.on("message", refresh);
        client.on("error", () => undefined);
      } catch {
        /* The HTTP snapshot also recovers missed notifications. */
      } finally {
        connecting = false;
      }
    }
    void connect();
    const reconnect = () => void connect();
    const timer = setInterval(reconnect, 20_000);
    window.addEventListener("focus", reconnect);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", reconnect);
      socket?.end(true);
    };
  }, [allowed, queryClient, session.csrfToken, userId]);
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
          Exceptions{data ? ` (${data.count})` : ""}
        </h2>
        {isError && (
          <p role="alert" className="text-xs text-destructive">
            Could not refresh items. Try again.
          </p>
        )}
        {!data && !isError && <p className="text-xs">Loading…</p>}
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
              {item.kind === "issue"
                ? (item.category && issueLabels[item.category]) ||
                  "Driver issue"
                : item.kind === "schedule"
                  ? "Schedule problem"
                  : "Vehicle in use"}{" "}
              {item.registration && <>· {item.registration}</>}
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
