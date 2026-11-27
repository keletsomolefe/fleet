import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { Redirect, useRouter } from "expo-router";
import {
  Button,
  Copy,
  Field,
  Heading,
  Notice,
  Screen,
  TruckCard,
  styles,
  useAction,
} from "@/components/ui";
import { pickPhoto, type CapturedPhoto } from "@/lib/photos";
import { useFleet } from "@/state/fleet";

export default function ReviewVehicle() {
  const router = useRouter();
  const fleet = useFleet(),
    action = useAction(),
    [flagged, setFlagged] = useState(false);

  const truck = fleet.selection?.truck;
  const [startKm, setStartKm] = useState(() =>
    truck?.odometerKm != null && truck.odometerKm > 0
      ? String(truck.odometerKm)
      : "",
  );
  const [startPhoto, setStartPhoto] = useState<CapturedPhoto | null>(null);
  const [noPhoto, setNoPhoto] = useState(false);
  const [missingPhotoReason, setMissingPhotoReason] = useState("");
  const [photoError, setPhotoError] = useState("");

  if (!truck) return <Redirect href="/vehicles" />;

  const occupied =
    !!truck.activeSession &&
    truck.activeSession.id !== fleet.driver?.drivingSession?.id;
  const mismatch =
    !!fleet.driver?.schedule && fleet.driver.schedule.truck.id !== truck.id;
  const blocked = occupied || truck.disputed;
  const sameTruckContinue = fleet.driver?.truck?.id === truck.id;

  const trimmedKm = startKm.trim();
  const kmValid = !trimmedKm || /^\d{1,9}(\.\d)?$/.test(trimmedKm);
  const missingPhotoBlocked =
    !sameTruckContinue &&
    Boolean(trimmedKm) &&
    !startPhoto &&
    noPhoto &&
    !missingPhotoReason.trim();

  async function handlePickPhoto(source: "camera" | "library") {
    setPhotoError("");
    try {
      const captured = await pickPhoto(source);
      if (captured) {
        setStartPhoto(captured);
        setNoPhoto(false);
      }
    } catch (cause) {
      setPhotoError(
        cause instanceof Error ? cause.message : "Could not capture photo.",
      );
    }
  }

  return (
    <Screen
      actions={
        <>
          {mismatch ? (
            <Button onPress={() => router.replace("/schedule-mismatch")}>
              Report a problem
            </Button>
          ) : blocked ? (
            !flagged &&
            truck.activeSession && (
              <Button
                loading={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await fleet.flagVehicle();
                    setFlagged(true);
                  })
                }
              >
                Report a problem
              </Button>
            )
          ) : (
            <Button
              loading={action.busy}
              disabled={!fleet.driver?.canDrive || !kmValid || missingPhotoBlocked}
              onPress={() =>
                void action.run(async () => {
                  if (!sameTruckContinue && !trimmedKm) {
                    throw new Error(
                      "Enter the vehicle’s starting odometer reading (km).",
                    );
                  }
                  if (
                    !sameTruckContinue &&
                    !startPhoto &&
                    !missingPhotoReason.trim()
                  ) {
                    throw new Error(
                      "Take an odometer photo, or select Photo unavailable and add a reason.",
                    );
                  }
                  await fleet.startDriving({
                    startOdometerKm: trimmedKm || null,
                    startOdometerMissingPhotoReason:
                      !startPhoto && missingPhotoReason.trim()
                        ? missingPhotoReason.trim()
                        : null,
                    startPhoto,
                  });
                  router.replace("/truck");
                })
              }
            >
              {sameTruckContinue
                ? "Continue driving"
                : fleet.driver?.drivingSession
                  ? "Switch vehicle"
                  : "Start driving"}
            </Button>
          )}
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.replace("/vehicles")}
          >
            Choose another vehicle
          </Button>
        </>
      }
    >
      <Heading
        title={
          mismatch
            ? "Schedule problem"
            : blocked
              ? "Vehicle unavailable"
              : fleet.driver?.schedule
                ? "Confirm today’s vehicle"
                : "Drive this vehicle?"
        }
        detail={
          blocked
            ? undefined
            : "Check the registration and record your starting odometer km."
        }
      />
      <TruckCard truck={truck} />

      {blocked && (
        <View style={styles.card}>
          <Copy>
            {flagged || truck.disputed ? "Waiting for review" : "Vehicle in use"}
          </Copy>
          {truck.activeSession && (
            <Copy small>{truck.activeSession.driverName}</Copy>
          )}
          <Copy small>
            {flagged || truck.disputed
              ? "Your administrator needs to check this before you can drive this vehicle."
              : "The current driver must finish first. Report a problem if this is incorrect."}
          </Copy>
        </View>
      )}

      {!blocked && !mismatch && !sameTruckContinue && (
        <View style={styles.card}>
          <Copy>Starting odometer</Copy>
          <Field
            label="Odometer reading (km)"
            keyboardType="decimal-pad"
            placeholder="e.g. 284560"
            value={startKm}
            onChangeText={setStartKm}
            hint={
              truck.odometerKm != null && truck.odometerKm > 0
                ? `Last recorded: ${truck.odometerKm.toLocaleString()} km`
                : "Read the dashboard km before moving."
            }
            error={
              kmValid ? undefined : "Enter a valid reading (e.g. 284560)."
            }
          />
          {startPhoto ? (
            <View style={{ gap: 8 }}>
              <Image
                source={{ uri: startPhoto.uri }}
                style={{ width: "100%", height: 160, borderRadius: 8 }}
                contentFit="cover"
              />
              <Button secondary onPress={() => setStartPhoto(null)}>
                Remove photo
              </Button>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <Button
                secondary
                onPress={() => void handlePickPhoto("camera")}
              >
                Take odometer photo
              </Button>
              <Button
                secondary
                onPress={() => void handlePickPhoto("library")}
              >
                Choose photo from gallery
              </Button>
              <Button
                secondary={!noPhoto}
                selected={noPhoto}
                onPress={() => setNoPhoto((v) => !v)}
              >
                Photo unavailable
              </Button>
            </View>
          )}
          {noPhoto && !startPhoto && (
            <Field
              label="Why is the odometer photo unavailable?"
              value={missingPhotoReason}
              onChangeText={setMissingPhotoReason}
              placeholder="e.g. Broken camera or dark cab"
            />
          )}
          <Notice message={photoError || undefined} />
        </View>
      )}

      {!blocked &&
        fleet.driver?.truck &&
        fleet.driver.truck.id !== truck.id && (
          <Copy small>
            Driving {fleet.driver.truck.registration} will end when you switch.
          </Copy>
        )}
      <Notice message={action.error || fleet.driver?.reason || undefined} />
    </Screen>
  );
}
