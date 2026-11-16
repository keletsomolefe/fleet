import { useForm, useStore } from "@tanstack/react-form";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useFleet } from "@/state/fleet";
import { Button, Field, Heading, Logo, Notice, Screen, useAction } from "./ui";
import { TrackingCard } from "./tracking-card";
export function Login() {
  const router = useRouter();
  const { login, refresh, error: contextError } = useFleet(),
    action = useAction();
  const form = useForm({
    defaultValues: { identifier: "", password: "" },
    validators: {
      onSubmit: ({ value }) =>
        value.identifier.trim() && value.password
          ? undefined
          : "Enter your email or driver ID and password.",
    },
    onSubmit: ({ value, formApi }) =>
      action.run(async () => {
        const destination = await login(
          value.identifier.trim(),
          value.password,
        );
        formApi.resetField("password");
        router.replace(destination);
      }),
  });
  const hasCredentials = useStore(
    form.store,
    (state) => !!(state.values.identifier.trim() && state.values.password),
  );
  const submit = () => {
    if (hasCredentials && !action.busy) void form.handleSubmit();
  };
  return (
    <Screen
      actions={
        <>
          <Button
            onPress={submit}
            loading={action.busy}
            disabled={!hasCredentials}
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
        <form.Field name="identifier">
          {(field) => (
            <Field
              label="Email or driver ID"
              value={field.state.value}
              onChangeText={field.handleChange}
              onBlur={field.handleBlur}
              editable={!action.busy}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
            />
          )}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <Field
              label="Password"
              value={field.state.value}
              onChangeText={field.handleChange}
              onBlur={field.handleBlur}
              editable={!action.busy}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={submit}
              returnKeyType="go"
            />
          )}
        </form.Field>
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
