import { useState } from "react";
import { View } from "react-native";
import { Redirect, router } from "expo-router";
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
export default function Review() {
  const fleet = useFleet(),
    action = useAction(),
    [replace, setReplace] = useState(false),
    selection = fleet.selection;
  if (!selection) return <Redirect href="/setup" />;
  const replacing =
    !!selection.truck.device?.enrolled ||
    !!(fleet.device?.truck && fleet.device.truck.id !== selection.truck.id) ||
    !!(fleet.device && fleet.device.device.identifier !== selection.identifier);
  return (
    <Screen
      actions={
        <>
          <Button
            loading={action.busy}
            disabled={replacing && !replace}
            onPress={() =>
              void action.run(async () => {
                await fleet.enroll(
                  selection.truck,
                  selection.identifier,
                  replace,
                );
                router.replace("/setup/ready");
              })
            }
          >
            {replacing ? "Replace and attach" : "Attach truck"}
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.back()}
          >
            Choose another truck
          </Button>
        </>
      }
    >
      <View style={{ gap: 20 }}>
        <Emblem name={replacing ? "alert" : "truck"} />
        <Heading
          center
          title={replacing ? "Replace device access?" : "Attach this truck?"}
          detail="Check the registration before attaching."
        />
        <TruckCard
          truck={selection.truck}
          meta={`Device: ${selection.identifier}`}
        />
        {replacing && (
          <View style={styles.card}>
            <Copy>The previous installation loses access.</Copy>
            <Copy small>
              Only continue if this device is installed in the selected truck.
            </Copy>
            <Button secondary onPress={() => setReplace(!replace)}>
              {replace ? "Replacement confirmed" : "Confirm replacement"}
            </Button>
          </View>
        )}
        <Notice message={action.error} />
      </View>
    </Screen>
  );
}
