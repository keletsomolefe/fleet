import { useState } from "react";
import { router } from "expo-router";
import {
  Button,
  Copy,
  Field,
  Heading,
  Screen,
  TruckCard,
  Notice,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
export default function ScheduleMismatch() {
  const fleet = useFleet(),
    action = useAction(),
    [note, setNote] = useState("");
  const scheduled = fleet.driver?.schedule,
    requested = fleet.selection?.truck;
  const alternative =
    requested && requested.id !== scheduled?.truck.id ? requested : null;
  return (
    <Screen
      actions={
        <>
          <Button
            loading={action.busy}
            disabled={
              !scheduled || !note.trim() || !!fleet.driver?.pendingDispute
            }
            onPress={() =>
              void action.run(async () => {
                await fleet.reportMismatch(alternative?.id ?? null, note);
                router.replace("/truck");
              })
            }
          >
            Send to administrator
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.push("/vehicles")}
          >
            Choose another vehicle
          </Button>
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.replace("/truck")}
          >
            Cancel
          </Button>
        </>
      }
    >
      <Heading title="Schedule problem" />
      {scheduled && (
        <>
          <Copy small>Scheduled for {scheduled.date}</Copy>
          <TruckCard truck={scheduled.truck} />
        </>
      )}
      {alternative && (
        <>
          <Copy small>Vehicle requested</Copy>
          <TruckCard truck={alternative} />
        </>
      )}
      <Field
        label="What needs to change?"
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={1000}
      />
      <Copy small>
        Your administrator must resolve this before you start driving.
      </Copy>
      <Notice message={action.error} />
    </Screen>
  );
}
