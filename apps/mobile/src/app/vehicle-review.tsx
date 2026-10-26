import { useState } from "react";
import { View } from "react-native";
import { Redirect, router } from "expo-router";
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

export default function ReviewVehicle() {
  const fleet = useFleet(),
    action = useAction(),
    [flagged, setFlagged] = useState(false);
  const truck = fleet.selection?.truck;
  if (!truck) return <Redirect href="/vehicles" />;
  const occupied =
    !!truck.activeSession &&
    truck.activeSession.id !== fleet.driver?.drivingSession?.id;
  const mismatch =
    !!fleet.driver?.schedule && fleet.driver.schedule.truck.id !== truck.id;
  const blocked = occupied || truck.disputed;
  return (
    <Screen
      actions={
        <>
          {mismatch ? (
            <Button onPress={() => router.replace("/schedule-mismatch")}>
              Report schedule mismatch
            </Button>
          ) : blocked ? (
            !flagged &&
            truck.activeSession && (
              <Button
                loading={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await fleet.flagVehicle();
                    setFlagged(true);
                  })
                }
              >
                Flag for review
              </Button>
            )
          ) : (
            <Button
              loading={action.busy}
              disabled={!fleet.driver?.canDrive}
              onPress={() =>
                void action.run(async () => {
                  await fleet.startDriving();
                  router.replace("/truck");
                })
              }
            >
              {fleet.driver?.truck?.id === truck.id
                ? "Continue driving"
                : fleet.driver?.drivingSession
                  ? "Switch vehicle"
                  : "Start driving"}
            </Button>
          )}
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.replace("/vehicles")}
          >
            Choose another vehicle
          </Button>
        </>
      }
    >
      <Heading
        title={
          mismatch
            ? "Schedule mismatch"
            : blocked
              ? "Vehicle unavailable"
              : fleet.driver?.schedule
                ? "Confirm today’s vehicle"
                : "Drive this vehicle?"
        }
        detail={
          blocked ? undefined : "Check the registration before continuing."
        }
      />
      <TruckCard truck={truck} />
      {blocked && (
        <View style={styles.card}>
          <Copy>
            {flagged || truck.disputed
              ? "Flagged for administrator review"
              : "Vehicle in use"}
          </Copy>
          {truck.activeSession && (
            <Copy small>{truck.activeSession.driverName}</Copy>
          )}
          <Copy small>
            {flagged || truck.disputed
              ? "Your administrator must resolve this before you can drive this vehicle."
              : "The current driver must finish driving first. Flag this vehicle if the details are incorrect."}
          </Copy>
        </View>
      )}
      {!blocked &&
        fleet.driver?.truck &&
        fleet.driver.truck.id !== truck.id && (
          <Copy small>
            Driving {fleet.driver.truck.registration} will end when you switch.
          </Copy>
        )}
      <Notice message={action.error || fleet.driver?.reason || undefined} />
    </Screen>
  );
}
