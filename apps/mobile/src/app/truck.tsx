import { ActivityIndicator, View } from "react-native";
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

  return (
    <Screen
      registration={scheduled && !currentTruck ? "Vehicle not confirmed" : undefined}
    >
      <View style={styles.group}>
        <Heading
          title={
            active ? "You’re driving" : scheduled ? "Today’s vehicle" : "Your vehicle"
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
            meta={active ? "Driving now" : "Confirm to continue"}
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
            Report an issue
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
