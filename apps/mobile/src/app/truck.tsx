import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Button,
  Copy,
  Heading,
  Notice,
  Screen,
  TruckCard,
  colors,
  styles,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
import { TrackingCard } from "@/components/tracking-card";
import { activityOutbox } from "@/activities/db";
import { getActivitySyncStatus, type Job } from "@/activities/service";

export default function Driving() {
  const router = useRouter();
  const fleet = useFleet();
  const action = useAction();
  const driver = fleet.driver;
  const active = !!driver?.confirmedAt;
  const scheduled = driver?.schedule;
  const pending = !!driver?.pendingDispute;
  const currentTruck = driver?.truck;
  const canReviewExceptions =
    fleet.session?.permissions.includes("admin.access") &&
    (fleet.session.permissions.includes("issues.read") ||
      fleet.session.permissions.includes("trucks.write"));

  const [dispatchCount, setDispatchCount] = useState(0);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web" || !driver?.driver.id) return;
    let mounted = true;
    const loadSummary = async () => {
      try {
        const q = await activityOutbox();
        const [jobs, status] = await Promise.all([
          q.cached<Job[]>(`jobs:${driver.driver.id}`),
          getActivitySyncStatus(),
        ]);
        if (!mounted) return;
        setDispatchCount(jobs?.length ?? 0);
        setPendingSync(status.pending);
      } catch {
        // Ignore on first load before SQLite opens
      }
    };
    void loadSummary();
    const timer = setInterval(() => void loadSummary(), 10_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [driver?.driver.id]);

  function chooseVehicle() {
    const truck =
      !active && (scheduled?.truck ?? (driver?.drivingSession && currentTruck));
    if (truck) {
      fleet.selectTruck(truck);
      router.push("/vehicle-review");
    } else {
      router.push("/vehicles");
    }
  }

  const startKm = driver?.drivingSession?.startOdometerKm;

  return (
    <Screen
      registration={
        scheduled && !currentTruck ? "Vehicle not confirmed" : undefined
      }
    >
      <View style={styles.group}>
        <Heading
          title={
            active
              ? "You’re driving"
              : scheduled
                ? "Today’s vehicle"
                : "Your vehicle"
          }
        />
        {!active && scheduled ? (
          <>
            <Copy small>{scheduled.date}</Copy>
            <TruckCard truck={scheduled.truck} meta="Scheduled" />
          </>
        ) : currentTruck ? (
          <TruckCard
            truck={currentTruck}
            meta={
              active
                ? startKm != null
                  ? `Driving now · Started at ${Number(startKm).toLocaleString()} km`
                  : "Driving now"
                : "Confirm to continue"
            }
          />
        ) : driver ? (
          <View style={styles.card}>
            <Copy>No vehicle selected</Copy>
            <Copy small>Choose the vehicle you are driving today.</Copy>
          </View>
        ) : !fleet.error ? (
          <ActivityIndicator
            color={colors.ink}
            accessibilityLabel="Loading your vehicle"
          />
        ) : null}

        {pending && (
          <Notice
            title="Waiting for review"
            message="The schedule problem has been sent to your administrator."
          />
        )}
        {driver?.drivingSession && !active && (
          <Notice
            title="Confirm your vehicle"
            message="Continue with this vehicle or finish driving."
          />
        )}
        <Notice message={driver?.reason ?? undefined} />
        <Notice message={action.error || fleet.error} />

        {active && driver && (
          <View style={styles.card}>
            <Copy>Jobs & activity</Copy>
            <Copy small>
              Record pickups, drop-offs, tonnage, petrol and road expenses —
              works offline.
            </Copy>
            {(dispatchCount > 0 || pendingSync > 0) && (
              <Copy small>
                {[
                  dispatchCount > 0
                    ? `${dispatchCount} assigned load${dispatchCount === 1 ? "" : "s"}`
                    : "",
                  pendingSync > 0 ? `${pendingSync} waiting to sync` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Copy>
            )}
            <Button onPress={() => router.push("/activities")}>
              Open jobs & activity
            </Button>
          </View>
        )}

        {pending || fleet.error ? (
          <Button
            loading={action.busy}
            onPress={() => void action.run(fleet.refresh)}
          >
            {pending ? "Check for updates" : "Refresh"}
          </Button>
        ) : null}
        {driver && !pending && (
          <Button
            secondary={active || !!fleet.error}
            disabled={!driver.canDrive || action.busy}
            onPress={chooseVehicle}
          >
            {active
              ? "Change vehicle"
              : scheduled
                ? "Confirm today’s vehicle"
                : driver.drivingSession
                  ? "Continue driving"
                  : "Choose a vehicle"}
          </Button>
        )}
        {driver?.drivingSession && (
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.push("/release")}
          >
            Finish driving
          </Button>
        )}
      </View>

      <TrackingCard />
      {driver && (
        <Copy small>
          {driver.driver.name} · {driver.driver.identifier}
        </Copy>
      )}
      <View style={[styles.actions, { marginTop: 0 }]}>
        {scheduled && !pending && (
          <Button
            secondary
            onPress={() => {
              fleet.selectTruck(scheduled.truck);
              router.push("/schedule-mismatch");
            }}
          >
            Report a schedule problem
          </Button>
        )}
        {driver && (
          <Button secondary onPress={() => router.push("/issues")}>
            Get help
          </Button>
        )}
        {canReviewExceptions && (
          <Button secondary onPress={() => router.push("/admin")}>
            Exceptions
          </Button>
        )}
        <Button
          secondary
          loading={action.busy}
          onPress={() => void action.run(fleet.logout)}
        >
          Sign out
        </Button>
      </View>
    </Screen>
  );
}
