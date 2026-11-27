import type { activityQueue } from "./queue";

export async function activityOutbox(): Promise<
  ReturnType<typeof activityQueue>
> {
  throw new Error("Offline activity recording is available in the mobile app.");
}
