export async function activityOutbox(): Promise<
  ReturnType<typeof import("./queue").activityQueue>
> {
  throw new Error("Open the installed Fleet app to continue.");
}
