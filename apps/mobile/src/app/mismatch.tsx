import { View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Copy,
  Emblem,
  Heading,
  Notice,
  Screen,
  styles,
  TruckCard,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
export default function Mismatch() {
  const fleet = useFleet(),
    action = useAction();
  return (
    <Screen
      actions={
        <>
          <Button
            loading={action.busy}
            onPress={() =>
              void action.run(async () => {
                await fleet.refresh();
                router.replace("/truck");
              })
            }
          >
            Refresh assigned truck
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => void action.run(fleet.logout)}
          >
            Back to sign in
          </Button>
        </>
      }
    >
      <View style={{ gap: 20 }}>
        <Emblem name="alert" />
        <Heading
          center
          title="Wrong truck?"
          detail="Do not confirm a registration that does not match."
        />
        {fleet.device?.truck && <TruckCard truck={fleet.device.truck} />}
        <View style={styles.card}>
          <Copy>Contact your fleet administrator</Copy>
          <Copy small>Ask them to check this device’s truck assignment.</Copy>
        </View>
        <Notice message={action.error || fleet.error} />
      </View>
    </Screen>
  );
}
