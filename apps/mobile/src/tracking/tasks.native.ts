import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import type { LocationObject } from "expo-location";
import {
  capture,
  flush,
  taskError,
  LOCATION_TASK,
  UPLOAD_TASK,
} from "./service";
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  try {
    if (error) {
      await taskError(error.message);
      return;
    }
    const locations = (data as { locations?: LocationObject[] } | undefined)
      ?.locations;
    if (locations?.length) await capture(locations);
  } catch (cause) {
    await taskError(
      cause instanceof Error ? cause.message : "Could not persist GPS records.",
    ).catch(() => undefined);
  }
});
TaskManager.defineTask(UPLOAD_TASK, async () => {
  try {
    await flush();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});
