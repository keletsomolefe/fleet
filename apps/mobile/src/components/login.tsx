import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useFleet } from "@/state/fleet";
import { Button, Field, Heading, Logo, Notice, Screen, useAction } from "./ui";
import { TrackingCard } from "./tracking-card";
export function Login() {
  const { login, refresh, error: contextError } = useFleet(),
    action = useAction();
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState("");
  function submit() {
    void action.run(async () => {
      const destination = await login(identifier.trim(), password);
      setPassword("");
      router.replace(destination);
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
            Sign in
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.push("/help")}
          >
            Need help?
          </Button>
        </>
      }
    >
      <View style={{ gap: 20 }}>
        <Logo />
        <Heading title="Welcome to VHH Fleet" />
        <Field
          label="Email or driver ID"
          value={identifier}
          onChangeText={setIdentifier}
          editable={!action.busy}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
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
        {!!contextError && (
          <Button
            secondary
            loading={action.busy}
            onPress={() => void action.run(refresh)}
          >
            Try again
          </Button>
        )}
        <TrackingCard />
      </View>
    </Screen>
  );
}
