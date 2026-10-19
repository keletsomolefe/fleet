import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useFleet } from "@/state/fleet";
import {
  Button,
  Copy,
  Field,
  Heading,
  Logo,
  Notice,
  Screen,
  styles,
  useAction,
} from "./ui";
import type { Mode } from "@/lib/api";
import { TrackingCard } from "./tracking-card";
export function Login({ mode }: { mode: Mode }) {
  const { login, device, refresh, error: contextError } = useFleet(),
    action = useAction();
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState("");
  const setup = mode === "setup";
  function submit() {
    void action.run(async () => {
      if (!setup && !device?.truck)
        throw new Error("Set up this device before signing in.");
      await login(identifier.trim(), password, mode);
      setPassword("");
      router.replace(setup ? "/setup" : "/truck");
    });
  }
  return (
    <Screen
      actions={
        <>
          <Button
            onPress={submit}
            loading={action.busy}
            disabled={!identifier.trim() || !password}
          >
            {setup ? "Sign in" : "Continue"}
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.push(setup ? "/device-setup" : "/help")}
          >
            {setup ? "Cancel" : "Need help?"}
          </Button>
        </>
      }
    >
      <View style={{ gap: 20 }}>
        <Logo />
        <Heading
          title={setup ? "Administrator sign in" : "Driver sign in"}
          detail={
            setup
              ? "Set up the device in this truck."
              : "Sign in to confirm your truck."
          }
        />
        {setup && (
          <View style={styles.card}>
            <Copy>Fleet administrator</Copy>
            <Copy small>Use your fleet account to attach this device.</Copy>
          </View>
        )}
        <Field
          label={setup ? "Email address" : "Driver ID"}
          value={identifier}
          onChangeText={setIdentifier}
          editable={!action.busy}
          autoCapitalize={setup ? "none" : "characters"}
          keyboardType={setup ? "email-address" : "default"}
          autoCorrect={false}
          autoComplete={setup ? "email" : "username"}
          textContentType={setup ? "emailAddress" : "username"}
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          editable={!action.busy}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <Notice message={action.error || contextError} />
        {!setup && !!contextError && (
          <Button
            secondary
            loading={action.busy}
            onPress={() => void action.run(refresh)}
          >
            Refresh assigned truck
          </Button>
        )}
        {!setup && !device?.truck && (
          <Button secondary onPress={() => router.push("/device-setup")}>
            Set up this device
          </Button>
        )}
        {!setup && <TrackingCard />}
      </View>
    </Screen>
  );
}
