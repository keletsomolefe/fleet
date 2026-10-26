import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Copy,
  Field,
  Heading,
  Notice,
  Screen,
  TruckCard,
  styles,
  useAction,
} from "@/components/ui";
import { request, type VehicleDispute } from "@/lib/api";
import { type DriverIssue, issueLabels } from "@/lib/issues";
import { useFleet } from "@/state/fleet";

export default function VehicleFlags() {
  const fleet = useFleet(),
    action = useAction(),
    token = fleet.session?.sessionToken;
  const [items, setItems] = useState<(VehicleDispute | DriverIssue)[] | null>(
      null,
    ),
    [selected, setSelected] = useState<VehicleDispute | DriverIssue | null>(
      null,
    ),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [outcome, setOutcome] = useState("");
  const load = useCallback(async () => {
    try {
      const [disputes, issues] = await Promise.all([
        request<{ items: VehicleDispute[] }>("admin/vehicle-disputes", {
          session: token,
        }),
        request<{ items: DriverIssue[] }>("admin/issues", { session: token }),
      ]);
      setItems(
        [...disputes.items, ...issues.items].sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        ),
      );
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load items.",
      );
    }
  }, [token]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!selected) void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load, fleet.attention.version, selected]);
  async function resolve(
    resolution:
      "keep_current" | "release_vehicle" | "keep_schedule" | "change_schedule",
  ) {
    if (!selected) return;
    if (selected.kind === "issue") {
      await request(`admin/issues/${selected.id}/resolve`, {
        method: "POST",
        session: token,
        body: { note },
      });
      setOutcome("Issue resolved.");
      setSelected(null);
      setNote("");
      await load();
      await fleet.refreshAttention();
      return;
    }
    await request(`admin/vehicle-disputes/${selected.id}/resolve`, {
      method: "POST",
      session: token,
      body: {
        resolution,
        note,
        expectedActiveSessionId:
          selected.kind === "schedule"
            ? (selected.requestedTruckSession?.id ?? null)
            : (selected.currentDriver?.id ?? null),
        ...(selected.kind === "schedule"
          ? {
              expectedScheduleId: selected.schedule?.id ?? null,
              expectedRequestedScheduleId: selected.requestedScheduleId,
            }
          : {}),
      },
    });
    setOutcome(
      resolution === "change_schedule"
        ? "Schedule updated. The driver can confirm the vehicle."
        : resolution === "keep_schedule"
          ? "Schedule confirmed. The driver can continue."
          : resolution === "release_vehicle"
            ? "Vehicle released. The next driver can select it."
            : "Resolved. The current driver can continue.",
    );
    setSelected(null);
    setNote("");
    await load();
    await fleet.refreshAttention();
  }
  return (
    <Screen
      actions={
        selected ? (
          <>
            <Button
              loading={action.busy}
              disabled={
                !note.trim() ||
                (selected.kind === "schedule" && !selected.requestedTruck)
              }
              onPress={() =>
                void action.run(() =>
                  resolve(
                    selected.kind === "schedule"
                      ? "change_schedule"
                      : "release_vehicle",
                  ),
                )
              }
            >
              {selected.kind === "issue"
                ? "Resolve issue"
                : selected.kind === "schedule"
                  ? "Assign requested vehicle"
                  : "Release vehicle"}
            </Button>
            {selected.kind !== "issue" && (
              <Button
                secondary
                disabled={
                  action.busy ||
                  !note.trim() ||
                  (selected.kind === "schedule"
                    ? !selected.schedule
                    : !selected.currentDriver)
                }
                onPress={() =>
                  void action.run(() =>
                    resolve(
                      selected.kind === "schedule"
                        ? "keep_schedule"
                        : "keep_current",
                    ),
                  )
                }
              >
                {selected.kind === "schedule"
                  ? "Keep current schedule"
                  : "Keep current driver"}
              </Button>
            )}
            <Button
              secondary
              disabled={action.busy}
              onPress={() => setSelected(null)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            {fleet.session?.permissions.includes("drivers.write") && (
              <Button secondary onPress={() => router.push("/schedules")}>
                Driver schedule
              </Button>
            )}
            <Button
              secondary
              loading={action.busy}
              onPress={() => void action.run(load)}
            >
              Refresh
            </Button>
            {fleet.session?.mode === "driver" && (
              <Button secondary onPress={() => router.replace("/truck")}>
                Back to driving
              </Button>
            )}
            <Button
              secondary
              loading={action.busy}
              onPress={() => void action.run(fleet.logout)}
            >
              Sign out
            </Button>
          </>
        )
      }
    >
      <Heading title={selected ? "Resolve item" : "Needs attention"} />
      {!!outcome && <Copy>{outcome}</Copy>}
      {selected ? (
        <>
          {selected.truck && <TruckCard truck={selected.truck} />}
          {selected.kind === "issue" && (
            <>
              <Copy>{issueLabels[selected.category]}</Copy>
              <Copy>{selected.description}</Copy>
              <Copy small>{new Date(selected.createdAt).toLocaleString()}</Copy>
            </>
          )}
          {selected.kind === "schedule" && (
            <>
              <Copy>Schedule problem · {selected.scheduleDate}</Copy>
              <Copy>{selected.driverNote}</Copy>
              {selected.requestedScheduledDriver && (
                <Copy small>
                  Scheduled driver for requested vehicle:{" "}
                  {selected.requestedScheduledDriver}
                </Copy>
              )}
              <Copy small>
                Requested:{" "}
                {selected.requestedTruck?.registration ?? "Not specified"}
              </Copy>
            </>
          )}
          <View style={styles.card}>
            <Copy>Flagged by {selected.requestedBy}</Copy>
            {selected.kind !== "issue" && (
              <Copy small>
                Current driver:{" "}
                {selected.currentDriver?.driverName ?? "No active driver"}
              </Copy>
            )}
          </View>
          <Field
            label="What was decided?"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={1000}
          />
        </>
      ) : items ? (
        <View style={{ gap: 12 }}>
          {!items.length && <Copy>Nothing to resolve.</Copy>}
          {items.map((item) =>
            item.kind === "issue" ? (
              <View key={item.id} style={styles.card}>
                <Copy>
                  {issueLabels[item.category]}
                  {item.truck ? ` · ${item.truck.registration}` : ""}
                </Copy>
                <Copy small>
                  {item.requestedBy} ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </Copy>
                <Copy>{item.description}</Copy>
                <Button
                  secondary
                  onPress={() => {
                    setSelected(item);
                    setNote("");
                    setOutcome("");
                  }}
                >
                  Review
                </Button>
              </View>
            ) : (
              <TruckCard
                key={item.id}
                truck={item.truck}
                meta={`${item.kind === "schedule" ? "Schedule problem" : "Vehicle in use"} · ${item.requestedBy}`}
                onPress={() => {
                  setSelected(item);
                  setNote("");
                  setOutcome("");
                }}
              />
            ),
          )}
        </View>
      ) : (
        !error && <ActivityIndicator accessibilityLabel="Loading items" />
      )}
      <Notice message={action.error || error || fleet.attention.error} />
    </Screen>
  );
}
