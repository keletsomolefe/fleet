import { useRouter } from "expo-router";
import { Button, Emblem, Heading, Screen } from "@/components/ui";
export default function Help() {
  const router = useRouter();
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
        title="Sign-in help"
        detail="Contact your administrator to reset your password or check your account."
      />
    </Screen>
  );
}
