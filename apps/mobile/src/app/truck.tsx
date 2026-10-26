import { View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Copy,
  Heading,
  Notice,
  Screen,
  TruckCard,
  styles,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
import { TrackingCard } from "@/components/tracking-card";

export default function Driving() {
  const fleet = useFleet(),
    action = useAction(),
    driver = fleet.driver;
  const active = !!driver?.confirmedAt;
  const scheduled = driver?.schedule;
  return (
    <Screen
      actions={
        <>
          {driver && (
            <Button
              disabled={!driver.canDrive || !!driver.pendingDispute}
              onPress={() => {
                if (!active && scheduled) {
                  fleet.selectTruck(scheduled.truck);
                  router.push("/vehicle-review");
                } else if (!active && driver.drivingSession && driver.truck) {
                  fleet.selectTruck(driver.truck);
                  router.push("/vehicle-review");
                } else router.push("/vehicles");
              }}
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
          {scheduled && !driver?.pendingDispute && (
            <Button
              secondary
              onPress={() => {
                fleet.selectTruck(scheduled.truck);
                router.push("/schedule-mismatch");
              }}
            >
              Report a problem
            </Button>
          )}
          {driver?.pendingDispute && (
            <Button secondary onPress={() => void action.run(fleet.refresh)}>
              Check for updates
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
          {fleet.session?.permissions?.includes("admin.access") &&
            fleet.session.permissions.includes("trucks.write") && (
              <Button secondary onPress={() => router.push("/admin")}>
                Needs attention
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
      }
    >
      <Heading
        title={
          active
            ? "You’re driving"
            : scheduled
              ? "Today’s vehicle"
              : "Your vehicle"
        }
      />
      {!active && scheduled && (
        <>
          <Copy small>{scheduled.date}</Copy>
          <TruckCard truck={scheduled.truck} meta="Scheduled" />
        </>
      )}
      {driver?.pendingDispute && (
        <Notice
          title="Waiting for review"
          message="The schedule problem has been sent to your administrator."
        />
      )}
      {driver?.truck && (active || !scheduled) ? (
        <TruckCard
          truck={driver.truck}
          meta={active ? "Driving now" : "Confirm to continue"}
        />
      ) : (
        !fleet.error &&
        !scheduled && (
          <View style={styles.card}>
            <Copy>No vehicle selected</Copy>
            <Copy small>Choose the vehicle you are driving today.</Copy>
          </View>
        )
      )}
      {driver?.drivingSession && !active && (
        <Notice
          title="Confirm your vehicle"
          message="Continue with this vehicle or finish driving."
        />
      )}
      {driver && (
        <Copy small>
          {driver.driver.name} · {driver.driver.identifier}
        </Copy>
      )}
      <Notice message={driver?.reason ?? undefined} />
      <TrackingCard />
      <Notice message={action.error || fleet.error} />
      {!!fleet.error && !scheduled && (
        <Button
          secondary
          loading={action.busy}
          onPress={() => void action.run(fleet.refresh)}
        >
          Refresh
        </Button>
      )}
    </Screen>
  );
}
