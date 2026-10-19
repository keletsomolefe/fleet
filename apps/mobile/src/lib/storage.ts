import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const keys = {
  session: "fleet.native-session.v1",
  device: "fleet.device-credential.v1",
  pending: "fleet.pending-device-credential.v1",
  name: "fleet.device-name.v1",
};
export async function read(key: string) {
  return Platform.OS === "web" ? null : SecureStore.getItemAsync(key, options);
}
export async function write(key: string, value: string) {
  if (Platform.OS === "web")
    throw new Error("Open the installed Fleet app to continue.");
  await SecureStore.setItemAsync(key, value, options);
}
export async function remove(key: string) {
  if (Platform.OS !== "web") await SecureStore.deleteItemAsync(key, options);
}
