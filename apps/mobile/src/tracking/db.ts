export async function outbox(): Promise<
  ReturnType<typeof import("./queue").queue>
> {
  throw new Error("Location sharing requires the installed VHH Fleet app.");
}
