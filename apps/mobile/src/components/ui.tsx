import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
  const router = useRouter();
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
          minHeight: 48,
          paddingVertical: 8,
          paddingHorizontal: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          backgroundColor: colors.surface,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Image
            source={require("../../assets/brand/monogram.svg")}
            contentFit="contain"
            contentPosition="center"
            accessible={false}
            style={{ width: 30, height: 30, flexShrink: 0 }}
          />
          <Text
            style={[
              styles.text,
              { flex: 1, fontFamily: "Montserrat_600SemiBold" },
            ]}
          >
            VHH Fleet
          </Text>
        </View>
        <View
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          {session?.permissions.includes("admin.access") &&
            (session.permissions.includes("issues.read") ||
              session.permissions.includes("trucks.write")) && (
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
  selected,
  fill = false,
}: {
  children: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
  fill?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        disabled: disabled || loading,
        busy: loading,
        selected,
      }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({
        ...(fill ? { flex: 1 } : null),
        minHeight: 48,
        paddingVertical: 12,
        paddingHorizontal: fill ? 12 : 20,
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
            // Measure against the available width; Android can clip words
            // when a custom-font label uses its intrinsic row width.
            flex: 1,
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
export function Chip({
  children,
  onPress,
  selected = false,
  disabled = false,
}: {
  children: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: selected ? colors.ink : colors.border,
        backgroundColor: selected ? colors.ink : colors.surface,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "flex-start",
      })}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.text,
          {
            fontSize: 13,
            lineHeight: 18,
            paddingHorizontal: 2,
            fontFamily: "Montserrat_600SemiBold",
            color: selected ? colors.surface : colors.ink,
          },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export interface PickerOption {
  id: string;
  label: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  badgeTone?: "primary" | "muted";
  searchText?: string;
}

export function PickerSheet({
  visible,
  title,
  subtitle,
  options,
  selectedId,
  placeholder = "Search…",
  emptyMessage = "No matching items.",
  allowCustom = false,
  customLabel = "Use",
  searchable = true,
  onSelect,
  onCustom,
  onClear,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: PickerOption[];
  selectedId?: string | null;
  placeholder?: string;
  emptyMessage?: string;
  allowCustom?: boolean;
  customLabel?: string;
  searchable?: boolean;
  onSelect: (option: PickerOption) => void;
  onCustom?: (text: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const filtered = needle
    ? options.filter((opt) =>
        `${opt.label} ${opt.subtitle ?? ""} ${opt.meta ?? ""} ${opt.searchText ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    : options;
  const exactMatch =
    !!trimmed &&
    options.some((opt) => opt.label.trim().toLowerCase() === needle);

  function close() {
    setQuery("");
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: "flex-end" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityLabel="Close picker"
          onPress={close}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(11, 11, 11, 0.42)" },
          ]}
        />
        <SafeAreaView
          edges={["bottom"]}
          style={{
            maxHeight: "82%",
            backgroundColor: colors.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              alignItems: "center",
              paddingTop: 10,
              paddingBottom: 4,
            }}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.border,
              }}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingTop: 6,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderColor: colors.border,
              gap: 12,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={[
                  styles.text,
                  { fontSize: 16, lineHeight: 22, fontFamily: "Montserrat_600SemiBold" },
                ]}
              >
                {title}
              </Text>
              {!!subtitle && <Copy small>{subtitle}</Copy>}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={close}
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 8,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                style={[
                  styles.text,
                  { fontFamily: "Montserrat_600SemiBold", color: colors.muted },
                ]}
              >
                Close
              </Text>
            </Pressable>
          </View>

          {searchable && (
            <View
              style={{
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.bg,
              }}
            >
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={placeholder}
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                returnKeyType="done"
                style={[
                  styles.text,
                  {
                    minHeight: 44,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                  },
                ]}
              />
            </View>
          )}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 12 }}
          >
            {onClear && !!selectedId && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClear();
                  close();
                }}
                style={({ pressed }) => ({
                  minHeight: 48,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.bg : colors.surface,
                  justifyContent: "center",
                })}
              >
                <Text
                  style={[
                    styles.text,
                    { color: colors.danger, fontFamily: "Montserrat_600SemiBold" },
                  ]}
                >
                  Clear selection
                </Text>
              </Pressable>
            )}

            {allowCustom && onCustom && !!trimmed && !exactMatch && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onCustom(trimmed);
                  close();
                }}
                style={({ pressed }) => ({
                  minHeight: 54,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.bg : "#fafafa",
                  justifyContent: "center",
                  gap: 2,
                })}
              >
                <Text
                  style={[
                    styles.text,
                    { fontFamily: "Montserrat_600SemiBold" },
                  ]}
                >
                  + {customLabel} &ldquo;{trimmed}&rdquo;
                </Text>
                <Copy small>Enter a new value not in the list</Copy>
              </Pressable>
            )}

            {filtered.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Copy small center>
                  {emptyMessage}
                </Copy>
              </View>
            ) : (
              filtered.map((opt) => {
                const isSelected = !!selectedId && opt.id === selectedId;
                return (
                  <Pressable
                    key={opt.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onSelect(opt);
                      close();
                    }}
                    style={({ pressed }) => ({
                      minHeight: 54,
                      paddingHorizontal: 20,
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderColor: colors.border,
                      backgroundColor:
                        pressed || isSelected ? colors.bg : colors.surface,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    })}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <Text
                          style={[
                            styles.text,
                            {
                              fontFamily: "Montserrat_600SemiBold",
                              flexShrink: 1,
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                        {!!opt.badge && (
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: 99,
                              backgroundColor:
                                opt.badgeTone === "primary"
                                  ? colors.ink
                                  : colors.border,
                            }}
                          >
                            <Text
                              style={[
                                styles.small,
                                {
                                  fontSize: 11,
                                  lineHeight: 15,
                                  fontFamily: "Montserrat_600SemiBold",
                                  color:
                                    opt.badgeTone === "primary"
                                      ? colors.surface
                                      : colors.muted,
                                },
                              ]}
                            >
                              {opt.badge}
                            </Text>
                          </View>
                        )}
                      </View>
                      {!!opt.subtitle && (
                        <Text style={[styles.small, { color: colors.ink }]}>
                          {opt.subtitle}
                        </Text>
                      )}
                      {!!opt.meta && <Copy small>{opt.meta}</Copy>}
                    </View>
                    {isSelected && <Icon name="check" size={18} />}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SelectField({
  label,
  value,
  placeholder,
  hint,
  onPress,
}: {
  label: string;
  value?: string | null;
  placeholder: string;
  hint?: string;
  onPress: () => void;
}) {
  const hasValue = Boolean(value && value.trim());
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.small, { color: colors.ink }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}${hasValue ? `: ${value}` : ""}`}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 48,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: pressed ? colors.bg : colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        })}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.text,
            {
              flex: 1,
              color: hasValue ? colors.ink : colors.muted,
            },
          ]}
        >
          {hasValue ? value : placeholder}
        </Text>
        <Text
          accessible={false}
          style={[styles.small, { fontSize: 14, color: colors.muted }]}
        >
          ▾
        </Text>
      </Pressable>
      {!!hint && <Copy small>{hint}</Copy>}
    </View>
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
