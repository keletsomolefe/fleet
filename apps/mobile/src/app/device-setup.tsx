import { View } from "react-native";
import { router } from "expo-router";
import { Button, Copy, Emblem, Heading, Screen, styles } from "@/components/ui";
export default function DeviceSetup() {
  return (
    <Screen
      actions={
        <>
          <Button onPress={() => router.push("/setup-login")}>
            Administrator sign in
          </Button>
          <Button secondary onPress={() => router.replace("/")}>
            Driver sign in
          </Button>
        </>
      }
    >
      <View style={{ gap: 20 }}>
        <Emblem name="truck" />
        <Heading
          center
          title="Set up this device"
          detail="Attach this device to the truck it is installed in."
        />
        <View style={styles.card}>
          <Copy>One device. One truck.</Copy>
          <Copy small>
            A fleet administrator will select the truck and check its
            registration.
          </Copy>
        </View>
      </View>
    </Screen>
  );
}
