import { router } from "expo-router";
import { Button, Copy, Emblem, Heading, Screen, styles } from "@/components/ui";
import { View } from "react-native";
export default function Help() {
  return (
    <Screen
      actions={
        <>
          <Button onPress={() => router.replace("/")}>Back to sign in</Button>
          <Button secondary onPress={() => router.push("/device-setup")}>
            Set up this device
          </Button>
        </>
      }
    >
      <Emblem name="info" />
      <Heading
        center
        title="Need help signing in?"
        detail="Contact your fleet administrator."
      />
      <View style={styles.card}>
        <Copy small>
          Ask your administrator to check your Driver ID, account access or
          password. For the wrong truck, ask them to set up this device again.
        </Copy>
      </View>
    </Screen>
  );
}
