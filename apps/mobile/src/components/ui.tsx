import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNetworkState } from "expo-network";
import { useFleet } from "@/state/fleet";
import type { Truck } from "@/lib/api";

export const colors = {
  bg: "#f6f6f6",
  surface: "#ffffff",
  ink: "#0b0b0b",
  muted: "#7a7a7a",
  border: "#ebebeb",
  danger: "#b42318",
};
export const styles = StyleSheet.create({
  text: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  title: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 20,
    lineHeight: 28,
    color: colors.ink,
  },
  small: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  group: { gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actions: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
    gap: 8,
    marginTop: 20,
  },
});
const icons = {
  truck: require("../../assets/icons/truck.svg"),
  alert: require("../../assets/icons/triangle-alert.svg"),
  info: require("../../assets/icons/info.svg"),
  check: require("../../assets/icons/check.svg"),
};
export function Icon({
  name,
  size = 28,
}: {
  name: keyof typeof icons;
  size?: number;
}) {
  return (
    <Image
      source={icons[name]}
      style={{ width: size, height: size }}
      accessibilityIgnoresInvertColors
    />
  );
}
export function Copy({
  children,
  small = false,
  center = false,
}: {
  children: ReactNode;
  small?: boolean;
  center?: boolean;
}) {
  return (
    <Text
      style={[
        small ? styles.small : styles.text,
        center && { textAlign: "center" },
      ]}
    >
      {children}
    </Text>
  );
}
export function Heading({
  title,
  detail,
  center = false,
}: {
  title: string;
  detail?: string;
  center?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        accessibilityRole="header"
        style={[styles.title, center && { textAlign: "center" }]}
      >
        {title}
      </Text>
      {!!detail && (
        <Copy small center={center}>
          {detail}
        </Copy>
      )}
    </View>
  );
}
export function Screen({
  children,
  actions,
  registration,
}: {
  children: ReactNode;
  actions?: ReactNode;
  registration?: string;
}) {
  const { driver, session, attention } = useFleet(),
    network = useNetworkState();
  const online =
    network.isConnected === true && network.isInternetReachable !== false;
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={["top", "bottom"]}
    >
      <View
        style={{
          height: 48,
          paddingHorizontal: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: colors.surface,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Image
            source={require("../../assets/brand/monogram.svg")}
            contentFit="contain"
            contentPosition="center"
            accessible={false}
            style={{ width: 30, height: 30, flexShrink: 0 }}
          />
          <Text style={[styles.text, { fontFamily: "Montserrat_600SemiBold" }]}>
            VHH Fleet
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {session?.permissions.includes("admin.access") &&
            session.permissions.includes("trucks.write") && (
              <Pressable
                onPress={() => router.push("/admin")}
                accessibilityRole="button"
                accessibilityLabel={`${attention.count} items to resolve`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  padding: 8,
                }}
              >
                <Icon name="alert" size={20} />
                {attention.count > 0 && (
                  <Text
                    style={[
                      styles.small,
                      {
                        backgroundColor: colors.danger,
                        color: "#fff",
                        borderRadius: 10,
                        minWidth: 20,
                        paddingHorizontal: 5,
                        textAlign: "center",
                      },
                    ]}
                  >
                    {attention.count > 99 ? "99+" : attention.count}
                  </Text>
                )}
              </Pressable>
            )}
          <View
            accessibilityLabel={online ? "Online" : "Offline"}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 99,
              paddingHorizontal: 10,
              paddingVertical: 4,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: online ? colors.ink : colors.muted,
              }}
            />
            <Copy small>
              {online
                ? "Online"
                : network.isConnected === false
                  ? "Offline"
                  : "Connecting"}
            </Copy>
          </View>
        </View>
      </View>
      <View
        style={{
          minHeight: 32,
          paddingHorizontal: 20,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text
          numberOfLines={1}
          style={[styles.small, { color: colors.ink, flex: 1 }]}
        >
          {registration ?? driver?.truck?.registration ?? "No vehicle selected"}
        </Text>
        <Text numberOfLines={1} style={[styles.small, { flexShrink: 1 }]}>
          {driver?.truck?.identifier ?? "VHH Fleet"}
        </Text>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 20 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        >
          <View style={{ flex: 1, gap: 20 }}>{children}</View>
          {actions && <View style={styles.actions}>{actions}</View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Button({
  children,
  onPress,
  secondary = false,
  disabled = false,
  loading = false,
}: {
  children: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: secondary ? colors.border : colors.ink,
        backgroundColor: secondary ? colors.surface : colors.ink,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
      })}
    >
      {loading && (
        <ActivityIndicator color={secondary ? colors.ink : colors.surface} />
      )}
      <Text
        style={[
          styles.text,
          {
            fontFamily: "Montserrat_600SemiBold",
            color: secondary ? colors.ink : colors.surface,
            textAlign: "center",
          },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  hint,
  error,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.small, { color: colors.ink }]}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[
          styles.text,
          {
            minHeight: 48,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: 8,
          },
          props.style,
        ]}
      />
      {!!(error || hint) && (
        <Text style={[styles.small, error ? { color: colors.danger } : null]}>
          {error || hint}
        </Text>
      )}
    </View>
  );
}
export function Notice({
  message,
  title = "Could not continue",
}: {
  message?: string;
  title?: string;
}) {
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.card, { flexDirection: "row", gap: 12 }]}
    >
      <Icon name="alert" size={24} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.text, { fontFamily: "Montserrat_600SemiBold" }]}>
          {title}
        </Text>
        <Copy small>{message}</Copy>
      </View>
    </View>
  );
}
export function TruckCard({
  truck,
  selected = false,
  onPress,
  meta,
}: {
  truck: Truck;
  selected?: boolean;
  onPress?: () => void;
  meta?: string;
}) {
  const content = (
    <>
      <Icon name="truck" />
      <View style={{ gap: 4, flex: 1 }}>
        <Text style={[styles.text, { fontFamily: "Montserrat_600SemiBold" }]}>
          {truck.registration}
        </Text>
        <Copy small>
          {truck.identifier} ·{" "}
          {[truck.make, truck.model].filter(Boolean).join(" ")}
        </Copy>
        {!!meta && (
          <Text style={[styles.small, { fontSize: 11, lineHeight: 16 }]}>
            {meta}
          </Text>
        )}
      </View>
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${truck.registration}, ${truck.identifier}`}
      onPress={onPress}
      style={[
        styles.card,
        {
          minHeight: 112,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.ink : colors.border,
        },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View
      style={[
        styles.card,
        { minHeight: 112, flexDirection: "row", alignItems: "center", gap: 12 },
      ]}
    >
      {content}
    </View>
  );
}
export function Emblem({ name }: { name: keyof typeof icons }) {
  return (
    <View
      style={{
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Icon name={name} size={32} />
    </View>
  );
}
export function Logo() {
  return (
    <Image
      source={require("../../assets/brand/logo.svg")}
      contentFit="contain"
      accessibilityLabel="VHH Fleet"
      style={{
        width: 208,
        height: 82,
        alignSelf: "center",
        marginVertical: 24,
      }}
    />
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError("") };
}
