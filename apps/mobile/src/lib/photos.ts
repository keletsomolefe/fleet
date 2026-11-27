import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

export type CapturedPhoto = {
  uri: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

function normalizeMime(raw?: string | null): CapturedPhoto["mimeType"] {
  if (raw === "image/png") return "image/png";
  if (raw === "image/webp") return "image/webp";
  return "image/jpeg";
}

export async function pickPhoto(
  source: "camera" | "library",
): Promise<CapturedPhoto | null> {
  if (Platform.OS === "web") {
    throw new Error("Photo capture is available in the mobile app.");
  }
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new Error(
        "Camera access was not granted. Enable camera permission in device settings or choose a saved photo.",
      );
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.72,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    return {
      uri: asset.uri,
      mimeType: normalizeMime(asset.mimeType),
    };
  }

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error(
      "Photo library access was not granted. Enable permission in device settings.",
    );
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.72,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: normalizeMime(asset.mimeType),
  };
}
