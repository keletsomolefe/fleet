import { View } from "react-native";
import { Redirect, router } from "expo-router";
import {
  Button,
  Emblem,
  Heading,
  Notice,
  Screen,
  TruckCard,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
export default function Ready() {
  const fleet = useFleet(),
    action = useAction();
  if (!fleet.device?.truck) return <Redirect href="/setup" />;
  return (
    <Screen
      actions={
        <>
          <Button
            loading={action.busy}
            onPress={() => void action.run(fleet.logout)}
          >
            Driver sign in
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.replace("/setup")}
          >
            Change truck
          </Button>
        </>
      }
    >
      <View style={{ gap: 20 }}>
        <Emblem name="check" />
        <Heading
          center
          title="Device ready"
          detail="Drivers can now sign in and confirm this registration."
        />
        <TruckCard
          truck={fleet.device.truck}
          meta={fleet.device.device.identifier}
        />
        <Notice message={action.error} />
      </View>
    </Screen>
  );
}
