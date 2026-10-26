import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { useFleet } from "@/state/fleet";
import { Button, Copy, Notice, styles, useAction } from "./ui";
import { emptyStatus } from "@/tracking/types";
import {
  syncLocationLog,
  getTrackingStatus,
  openLocationSettings,
  startTracking,
  stopTracking,
  watchTracking,
} from "@/tracking/service";
export function TrackingCard() {
  const fleet = useFleet(),
    action = useAction(),
    [state, setState] = useState(emptyStatus);
  useEffect(() => {
    let mounted = true;
    const update = () => {
      void getTrackingStatus().then((value) => {
        if (mounted) setState(value);
      });
    };
    update();
    const stop = watchTracking();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") update();
    }, 3000);
    return () => {
      mounted = false;
      stop();
      clearInterval(timer);
    };
  }, []);
  async function run(work: () => Promise<unknown>) {
    await action.run(work);
    setState(await getTrackingStatus());
  }
  if (
    !state.active &&
    !state.pending &&
    !state.blocked &&
    !state.error &&
    !fleet.driver?.confirmedAt
  )
    return null;
  return (
    <View style={styles.card}>
      <Copy>
        {state.active
          ? state.collecting
            ? "Location sharing on"
            : "Location sharing paused"
          : "Location sharing off"}
      </Copy>
      {state.pending > 0 && (
        <Copy small>
          {state.pending} {state.pending === 1 ? "location" : "locations"}{" "}
          waiting to send
        </Copy>
      )}
      {state.lastFixAt && (
        <Copy small>
          Last location: {new Date(state.lastFixAt).toLocaleTimeString()}
        </Copy>
      )}
      {state.blocked > 0 && (
        <Notice
          title="Locations need attention"
          message="Some saved locations need checking. Contact your administrator."
        />
      )}
      {state.active ? (
        <Button
          secondary
          loading={action.busy}
          onPress={() => void run(() => stopTracking())}
        >
          Stop sharing
        </Button>
      ) : (
        fleet.session?.mode === "driver" &&
        fleet.driver?.confirmedAt && (
          <>
            <Copy small>
              Allow precise location and “all the time” access to share your
              route while you use other apps. Your route is saved when you’re
              offline.
            </Copy>
            <Button
              loading={action.busy}
              onPress={() =>
                void run(() => startTracking(fleet.session!, fleet.driver!))
              }
            >
              Share location
            </Button>
          </>
        )
      )}
      {(state.pending > 0 || !!state.error) && (
        <Button
          secondary
          loading={action.busy}
          onPress={() => void run(syncLocationLog)}
        >
          Send saved locations
        </Button>
      )}
      <Notice message={action.error || state.error} />
      {/precise|all.the.time|background location|device location/i.test(
        action.error || state.error,
      ) && (
        <Button secondary onPress={() => void openLocationSettings()}>
          Location settings
        </Button>
      )}
    </View>
  );
}
