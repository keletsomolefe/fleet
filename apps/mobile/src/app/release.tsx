import { Redirect, router } from "expo-router";
import {
  Button,
  Copy,
  Heading,
  Notice,
  Screen,
  TruckCard,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
export default function ReleaseVehicle() {
  const fleet = useFleet(),
    action = useAction();
  if (!fleet.driver?.truck || !fleet.driver.drivingSession)
    return <Redirect href="/truck" />;
  return (
    <Screen
      actions={
        <>
          <Button
            loading={action.busy}
            onPress={() =>
              void action.run(async () => {
                await fleet.finishDriving();
                router.replace("/truck");
              })
            }
          >
            Finish driving
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.replace("/truck")}
          >
            Keep driving
          </Button>
        </>
      }
    >
      <Heading title="Finish driving?" />
      <TruckCard truck={fleet.driver.truck} />
      <Copy>
        {fleet.driver.truck.disputed
          ? "Location sharing stops. Another driver can use this vehicle after administrator review."
          : "Location sharing stops and this vehicle becomes available to the next driver."}
      </Copy>
      <Notice message={action.error} />
    </Screen>
  );
}
