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

export default function ReleaseVehicle() {
  const router = useRouter();
  const fleet = useFleet(),
    action = useAction();

  const [endKm, setEndKm] = useState("");
  const [endPhoto, setEndPhoto] = useState<CapturedPhoto | null>(null);
  const [noPhoto, setNoPhoto] = useState(false);
  const [missingPhotoReason, setMissingPhotoReason] = useState("");
  const [lowerReason, setLowerReason] = useState("");
  const [photoError, setPhotoError] = useState("");

  if (!fleet.driver?.truck || !fleet.driver.drivingSession)
    return <Redirect href="/truck" />;

  const startKm = fleet.driver.drivingSession.startOdometerKm;
  const trimmedEnd = endKm.trim();
  const kmValid = !trimmedEnd || /^\d{1,9}(\.\d)?$/.test(trimmedEnd);
  const isLower =
    Boolean(trimmedEnd) &&
    kmValid &&
    startKm != null &&
    Number(trimmedEnd) < Number(startKm);

  async function handlePickPhoto(source: "camera" | "library") {
    setPhotoError("");
    try {
      const captured = await pickPhoto(source);
      if (captured) {
        setEndPhoto(captured);
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
          <Button
            loading={action.busy}
            disabled={!kmValid}
            onPress={() =>
              void action.run(async () => {
                if (!trimmedEnd) {
                  throw new Error(
                    "Enter the ending odometer reading (km) before finishing.",
                  );
                }
                if (!endPhoto && !missingPhotoReason.trim()) {
                  throw new Error(
                    "Take an odometer photo, or select Photo unavailable and add a reason.",
                  );
                }
                if (isLower && !lowerReason.trim()) {
                  throw new Error(
                    "End reading is lower than your start reading. Enter a short reason.",
                  );
                }
                await fleet.finishDriving({
                  endOdometerKm: trimmedEnd,
                  endOdometerMissingPhotoReason:
                    !endPhoto && missingPhotoReason.trim()
                      ? missingPhotoReason.trim()
                      : null,
                  endOdometerLowerReason:
                    isLower && lowerReason.trim() ? lowerReason.trim() : null,
                  endPhoto,
                });
                router.replace("/truck");
              })
            }
          >
            Finish driving
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.replace("/truck")}
          >
            Keep driving
          </Button>
        </>
      }
    >
      <Heading title="Finish driving?" />
      <TruckCard
        truck={fleet.driver.truck}
        meta={
          startKm != null
            ? `Started at ${Number(startKm).toLocaleString()} km`
            : undefined
        }
      />

      <View style={styles.card}>
        <Copy>Ending odometer</Copy>
        <Field
          label="End odometer reading (km)"
          keyboardType="decimal-pad"
          placeholder={startKm ?? "e.g. 284742"}
          value={endKm}
          onChangeText={setEndKm}
          hint={
            startKm != null
              ? `Shift started at ${Number(startKm).toLocaleString()} km`
              : "Read the dashboard km before releasing this vehicle."
          }
          error={kmValid ? undefined : "Enter a valid reading (e.g. 284742)."}
        />
        {isLower && (
          <Field
            label="Why is this reading lower than start km?"
            value={lowerReason}
            onChangeText={setLowerReason}
            placeholder="e.g. Mistyped start reading"
          />
        )}
        {endPhoto ? (
          <View style={{ gap: 8 }}>
            <Image
              source={{ uri: endPhoto.uri }}
              style={{ width: "100%", height: 160, borderRadius: 8 }}
              contentFit="cover"
            />
            <Button secondary onPress={() => setEndPhoto(null)}>
              Remove photo
            </Button>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Button secondary onPress={() => void handlePickPhoto("camera")}>
              Take odometer photo
            </Button>
            <Button secondary onPress={() => void handlePickPhoto("library")}>
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
        {noPhoto && !endPhoto && (
          <Field
            label="Why is the odometer photo unavailable?"
            value={missingPhotoReason}
            onChangeText={setMissingPhotoReason}
            placeholder="e.g. Dark cab or camera issue"
          />
        )}
        <Notice message={photoError || undefined} />
      </View>

      <Copy small>
        {fleet.driver.truck.disputed
          ? "Location sharing stops. Another driver can use this vehicle after administrator review."
          : "Location sharing stops and this vehicle becomes available to the next driver."}
      </Copy>
      <Notice message={action.error} />
    </Screen>
  );
}
