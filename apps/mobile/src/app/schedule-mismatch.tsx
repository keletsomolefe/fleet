import { useForm, useStore } from "@tanstack/react-form";
import { useRouter } from "expo-router";
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
  const router = useRouter();
  const fleet = useFleet(),
    action = useAction();
  const scheduled = fleet.driver?.schedule,
    requested = fleet.selection?.truck;
  const alternative =
    requested && requested.id !== scheduled?.truck.id ? requested : null;
  const form = useForm({
    defaultValues: { note: "" },
    onSubmit: ({ value }) =>
      action.run(async () => {
        if (!scheduled || !value.note.trim() || fleet.driver?.pendingDispute)
          return;
        await fleet.reportMismatch(alternative?.id ?? null, value.note);
        router.replace("/truck");
      }),
  });
  const hasNote = useStore(form.store, (state) => !!state.values.note.trim());
  return (
    <Screen
      actions={
        <>
          <Button
            loading={action.busy}
            disabled={!scheduled || !hasNote || !!fleet.driver?.pendingDispute}
            onPress={() => void form.handleSubmit()}
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
      <form.Field name="note">
        {(field) => (
          <Field
            label="What needs to change?"
            value={field.state.value}
            onChangeText={field.handleChange}
            onBlur={field.handleBlur}
            editable={!action.busy}
            multiline
            maxLength={1000}
          />
        )}
      </form.Field>
      <Copy small>
        Your administrator must resolve this before you start driving.
      </Copy>
      <Notice message={action.error} />
    </Screen>
  );
}
