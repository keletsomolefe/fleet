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
} from "@/components/ui";
import { request, type Truck, type TruckList } from "@/lib/api";
import { useFleet } from "@/state/fleet";

export default function ChooseVehicle() {
  const fleet = useFleet();
  const [query, setQuery] = useState(""),
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
      setSelected(null);
      setResult(null);
      void request<TruckList>(
        `driver/vehicles?q=${encodeURIComponent(query)}&page=${page}`,
        { session: fleet.session?.sessionToken },
      )
        .then((value) => {
          if (current) {
            setResult(value);
            setError("");
          }
        })
        .catch((cause) => {
          if (current)
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not load vehicles.",
            );
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
  return (
    <Screen
      actions={
        <>
          <Button
            disabled={!selected || loading || !fleet.driver?.canDrive}
            onPress={() => {
              if (selected) {
                fleet.selectTruck(selected);
                router.push(
                  fleet.driver?.schedule &&
                    fleet.driver.schedule.truck.id !== selected.id
                    ? "/schedule-mismatch"
                    : "/vehicle-review",
                );
              }
            }}
          >
            Continue
          </Button>
          <Button secondary onPress={() => router.replace("/truck")}>
            Cancel
          </Button>
        </>
      }
    >
      <Heading title="Choose a vehicle" />
      <Field
        label="Search vehicles"
        placeholder="Registration or fleet number"
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setPage(1);
          setSelected(null);
          setLoading(true);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
      />
      <Notice message={fleet.driver?.reason ?? undefined} />
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading vehicles" />
      ) : (
        <View style={{ gap: 12 }}>
          {result?.items.map((truck) => (
            <TruckCard
              key={truck.id}
              truck={truck}
              selected={selected?.id === truck.id}
              onPress={() => setSelected(truck)}
              meta={
                truck.disputed
                  ? "Flagged for review"
                  : truck.activeSession
                    ? `In use · ${truck.activeSession.driverName}`
                    : truck.scheduled
                      ? "Scheduled"
                      : "Available"
              }
            />
          ))}
          {result && !result.items.length && (
            <>
              <Copy>No matching vehicles.</Copy>
              {!!query && (
                <Button
                  secondary
                  onPress={() => {
                    setQuery("");
                    setPage(1);
                    setLoading(true);
                  }}
                >
                  Clear search
                </Button>
              )}
            </>
          )}
          {result && result.total > result.pageSize && (
            <View style={{ gap: 12 }}>
              <Copy small>
                Page {page} of {Math.ceil(result.total / result.pageSize)}
              </Copy>
              <Button
                secondary
                disabled={page === 1}
                onPress={() => {
                  setLoading(true);
                  setSelected(null);
                  setPage((p) => p - 1);
                }}
              >
                Previous
              </Button>
              <Button
                secondary
                disabled={page * result.pageSize >= result.total}
                onPress={() => {
                  setLoading(true);
                  setSelected(null);
                  setPage((p) => p + 1);
                }}
              >
                Next
              </Button>
            </View>
          )}
        </View>
      )}
      <Notice message={error} />
      {!!error && (
        <Button secondary onPress={() => setReload((v) => v + 1)}>
          Try again
        </Button>
      )}
    </Screen>
  );
}
