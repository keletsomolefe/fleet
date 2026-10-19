import { View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Copy,
  Emblem,
  Heading,
  Notice,
  Screen,
  styles,
  TruckCard,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
import { TrackingCard } from "@/components/tracking-card";
export default function ConfirmTruck() {
  const fleet = useFleet(),
    action = useAction(),
    driver = fleet.driver,
    confirmed = !!driver?.confirmedAt && driver.canConfirm;
  return (
    <Screen
      actions={
        <>
          {confirmed ? (
            <Button
              onPress={() => void action.run(fleet.refresh)}
              loading={action.busy}
            >
              Refresh truck
            </Button>
          ) : (
            <Button
              disabled={!driver?.canConfirm}
              onPress={() => void action.run(fleet.confirm)}
              loading={action.busy}
            >
              Yes, this is my truck
            </Button>
          )}
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.push("/mismatch")}
          >
            This is not my truck
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => void action.run(fleet.logout)}
          >
            Sign out
          </Button>
        </>
      }
    >
      <View style={{ gap: 20 }}>
        <Emblem name={confirmed ? "check" : "truck"} />
        <Heading
          center
          title={confirmed ? "Truck confirmed" : "Is this your truck?"}
          detail={
            confirmed
              ? "Your registration has been confirmed."
              : "Check the registration of the truck you are in."
          }
        />
        {driver?.truck && (
          <TruckCard truck={driver.truck} />
        )}
        {driver && (
          <View style={styles.card}>
            <Copy>{driver.driver.name}</Copy>
            <Copy small>{driver.driver.identifier}</Copy>
          </View>
        )}
        <TrackingCard />
        <Notice
          title="Check with your administrator"
          message={driver?.reason ?? undefined}
        />
        <Notice message={action.error || fleet.error} />
        {!driver && (
          <Button
            secondary
            onPress={() => void action.run(fleet.refresh)}
            loading={action.busy}
          >
            Refresh assigned truck
          </Button>
        )}
      </View>
    </Screen>
  );
}
