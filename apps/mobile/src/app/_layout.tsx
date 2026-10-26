import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
} from "@expo-google-fonts/montserrat";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FleetProvider, useFleet } from "@/state/fleet";
import { colors } from "@/components/ui";
void SplashScreen.preventAutoHideAsync();
function Routes() {
  const { ready, session } = useFleet();
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade",
        }}
      >
        <Stack.Protected guard={!session}>
          <Stack.Screen name="index" />
          <Stack.Screen name="device-setup" />
          <Stack.Screen name="setup-login" />
          <Stack.Screen name="help" />
        </Stack.Protected>
        <Stack.Protected guard={session?.mode === "driver"}>
          <Stack.Screen name="truck" />
          <Stack.Screen name="issues" />
          <Stack.Screen name="activities" />
          <Stack.Screen name="vehicles" />
          <Stack.Screen name="vehicle-review" />
          <Stack.Screen name="schedule-mismatch" />
          <Stack.Screen name="release" />
          <Stack.Screen name="mismatch" />
        </Stack.Protected>
        <Stack.Protected
          guard={
            session?.mode === "admin" ||
            (!!session?.permissions?.includes("admin.access") &&
              !!session?.permissions?.includes("trucks.write"))
          }
        >
          <Stack.Screen name="admin" />
          <Stack.Screen name="schedules" />
          <Stack.Screen name="setup" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
export default function Layout() {
  const [loaded, error] = useFonts({
    Montserrat_500Medium,
    Montserrat_600SemiBold,
  });
  useEffect(() => {
    if (error) throw error;
  }, [error]);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <FleetProvider>
        <Routes />
      </FleetProvider>
    </SafeAreaProvider>
  );
}
