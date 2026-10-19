import { router } from "expo-router";
import { Button, Copy, Emblem, Heading, Screen, styles } from "@/components/ui";
import { View } from "react-native";
export default function Help() {
  return (
    <Screen
      actions={
        <>
          <Button onPress={() => router.replace("/")}>Back to sign in</Button>
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
          Ask your administrator to check your email or Driver ID, account
          access or password. To attach or change the truck, an administrator
          signs in here.
        </Copy>
      </View>
    </Screen>
  );
}
