import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Copy,
  Field,
  Heading,
  Notice,
  Screen,
  TruckCard,
  useAction,
} from "@/components/ui";
import { request, type Truck, type TruckList } from "@/lib/api";
import { useFleet } from "@/state/fleet";
export default function ChooseTruck() {
  const fleet = useFleet(),
    action = useAction();
  const [identifier, setIdentifier] = useState(fleet.deviceName),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [result, setResult] = useState<TruckList | null>(null),
    [selected, setSelected] = useState<Truck | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void request<TruckList>(
        `setup/trucks?q=${encodeURIComponent(query)}&page=${page}`,
        { session: fleet.session?.sessionToken },
      )
        .then((value) => {
          if (current) {
            setResult(value);
            setError("");
          }
        })
        .catch((cause) => {
          if (current) {
            setResult(null);
            setError(
              cause instanceof Error ? cause.message : "Could not load trucks.",
            );
          }
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, page, reload, fleet.session?.sessionToken]);
  const valid = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(identifier.trim());
  return (
    <Screen
      actions={
        <>
          <Button
            disabled={!selected || !valid || loading}
            onPress={() => {
              if (selected) {
                fleet.selectTruck(selected, identifier.trim().toUpperCase());
                router.push("/setup/review");
              }
            }}
          >
            Continue
          </Button>
          <Button
            secondary
            loading={action.busy}
            onPress={() => void action.run(fleet.logout)}
          >
            Cancel
          </Button>
        </>
      }
    >
      <View style={{ gap: 16 }}>
        <Heading
          title="Attach a truck"
          detail="Select the truck for this device."
        />
        <Field
          label="Device identifier"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={80}
          hint="Letters, numbers, hyphens and underscores."
          error={
            identifier && !valid
              ? "Enter a valid device identifier."
              : undefined
          }
        />
        <Field
          label="Search trucks"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setPage(1);
            setSelected(null);
          }}
          placeholder="Registration or truck ID"
          autoCorrect={false}
          returnKeyType="search"
        />
        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading trucks" />
        ) : (
          result?.items.map((truck) => (
            <TruckCard
              key={truck.id}
              truck={truck}
              selected={selected?.id === truck.id}
              onPress={() => setSelected(truck)}
              meta={
                truck.device
                  ? `Device: ${truck.device.identifier}`
                  : "No device attached"
              }
            />
          ))
        )}
        {!loading && result?.total === 0 && (
          <>
            <Emptiness />
            <Button
              secondary
              onPress={() => {
                setQuery("");
                setPage(1);
                setReload((n) => n + 1);
              }}
            >
              Refresh trucks
            </Button>
          </>
        )}
        <Notice message={error || action.error} />
        {!!error && (
          <Button secondary onPress={() => setReload((n) => n + 1)}>
            Try again
          </Button>
        )}
        {result && result.total > result.pageSize && (
          <>
            <Copy small>
              Page {result.page} of {Math.ceil(result.total / result.pageSize)}
            </Copy>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  secondary
                  disabled={page === 1 || loading}
                  onPress={() => {
                    setPage((p) => p - 1);
                    setSelected(null);
                  }}
                >
                  Previous
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  secondary
                  disabled={page * result.pageSize >= result.total || loading}
                  onPress={() => {
                    setPage((p) => p + 1);
                    setSelected(null);
                  }}
                >
                  Next
                </Button>
              </View>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
function Emptiness() {
  return (
    <Heading
      title="No trucks found"
      detail="Try another registration or ask your administrator to add the truck."
    />
  );
}
