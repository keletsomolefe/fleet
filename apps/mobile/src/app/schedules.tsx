import { useForm, useStore } from "@tanstack/react-form";
import { useEffect, useState, useCallback } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
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
import { ApiError, request, type Truck } from "@/lib/api";
import { useFleet } from "@/state/fleet";
type Entry = {
  id: string;
  date: string;
  registration: string;
  driverName: string;
};
type Options = {
  drivers: { id: string; name: string; identifier: string }[];
  trucks: Truck[];
};
const day = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export default function Schedules() {
  const router = useRouter();
  const fleet = useFleet(),
    action = useAction(),
    token = fleet.session?.sessionToken;
  const [options, setOptions] = useState<Options>({ drivers: [], trucks: [] }),
    [items, setItems] = useState<Entry[]>([]),
    [conflicts, setConflicts] = useState<
      { id: string; date: string; driverName: string; registration: string }[]
    >([]),
    [error, setError] = useState(""),
    [outcome, setOutcome] = useState(""),
    [cancel, setCancel] = useState<Entry | null>(null);
  const today = day();
  const form = useForm({
    defaultValues: {
      from: today,
      to: today,
      driver: "",
      truck: "",
      weekdays: [1, 2, 3, 4, 5],
      note: "",
    },
    validators: {
      onSubmit: ({ value }) => {
        if (cancel) return value.note.trim() ? undefined : "Enter a reason.";
        const isDate = (date: string) =>
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          Number.isFinite(Date.parse(date)) &&
          new Date(date).toISOString().slice(0, 10) === date;
        if (!isDate(value.from) || !isDate(value.to))
          return "Enter valid dates.";
        if (
          value.from > value.to ||
          Date.parse(value.to) - Date.parse(value.from) > 92 * 86400000
        )
          return "Choose a range of up to 93 days.";
        if (!value.driver || !value.truck)
          return "Choose a driver and vehicle.";
        if (!value.weekdays.length) return "Choose the days of the week.";
        if (conflicts.length && !value.note.trim()) return "Enter a reason.";
      },
    },
    onSubmit: ({ value, formApi }) =>
      action.run(async () => {
        await save(value);
        formApi.resetField("note");
      }),
  });
  const { from, to, driver, truck, weekdays, note } = useStore(
    form.store,
    (state) => state.values,
  );
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  const [driverQuery, setDriverQuery] = useState("");
  const [truckQuery, setTruckQuery] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await request<{ items: Entry[] }>(
        `admin/schedules?from=${from}&to=${to}`,
        { session: token },
      );
      setItems(result.items);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load schedule.",
      );
    }
  }, [from, to, token]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 350);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void Promise.all([
        request<Options>(
          `admin/schedules/options?q=${encodeURIComponent(driverQuery)}`,
          { session: token },
        ),
        request<Options>(
          `admin/schedules/options?q=${encodeURIComponent(truckQuery)}`,
          { session: token },
        ),
      ])
        .then(([d, t]) => {
          if (active) setOptions({ drivers: d.drivers, trucks: t.trucks });
        })
        .catch((cause) => {
          if (active) setError(cause.message);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token, driverQuery, truckQuery]);
  function preset(mode: "week" | "month") {
    const d = new Date(day() + "T00:00:00Z"),
      end = new Date(d);
    if (mode === "week") {
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      end.setTime(d.getTime() + 6 * 86400000);
    } else {
      d.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
    }
    form.setFieldValue("from", d.toISOString().slice(0, 10));
    form.setFieldValue("to", end.toISOString().slice(0, 10));
    setConflicts([]);
  }
  async function save({
    from,
    to,
    driver,
    truck,
    weekdays,
    note,
  }: typeof form.state.values) {
    // A conflict preview is returned by the same strict endpoint; an explicit second tap confirms it.
    const body = cancel
      ? { note }
      : {
          driverId: driver,
          truckId: truck,
          from,
          to,
          weekdays,
          note,
          override: conflicts.length > 0,
          expectedConflicts: conflicts.map((c) => c.id),
        };
    try {
      await request(
        cancel ? `admin/schedules/${cancel.id}/cancel` : "admin/schedules",
        { method: "POST", session: token, body },
      );
      setOutcome(cancel ? "Scheduled day cancelled." : "Schedule saved.");
      setCancel(null);
      setConflicts([]);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && Array.isArray(cause.details?.conflicts))
        setConflicts(
          cause.details.conflicts as {
            id: string;
            date: string;
            driverName: string;
            registration: string;
          }[],
        );
      else setConflicts([]);
      throw cause;
    }
  }
  return (
    <Screen
      actions={
        <>
          <Button
            loading={busy}
            disabled={
              cancel
                ? !note.trim()
                : !driver ||
                  !truck ||
                  !weekdays.length ||
                  (!!conflicts.length && !note.trim())
            }
            onPress={() => void form.handleSubmit()}
          >
            {cancel
              ? "Cancel scheduled day"
              : conflicts.length
                ? "Replace scheduled days"
                : "Save schedule"}
          </Button>
          <Button
            secondary
            disabled={busy}
            onPress={() => router.replace("/admin")}
          >
            Back to review
          </Button>
        </>
      }
    >
      <Heading title="Driver schedule" />
      {!!outcome && <Copy>{outcome}</Copy>}
      <View style={{ gap: 8 }}>
        <Button secondary disabled={busy} onPress={() => preset("week")}>
          This week
        </Button>
        <Button secondary disabled={busy} onPress={() => preset("month")}>
          This month
        </Button>
      </View>
      <Field
        label="From (YYYY-MM-DD)"
        value={from}
        editable={!busy}
        onChangeText={(v) => {
          form.setFieldValue("from", v);
          setConflicts([]);
        }}
      />
      <Field
        label="To (YYYY-MM-DD)"
        value={to}
        editable={!busy}
        onChangeText={(v) => {
          form.setFieldValue("to", v);
          setConflicts([]);
        }}
      />
      {cancel ? (
        <>
          <Copy>
            {cancel.date} · {cancel.driverName} · {cancel.registration}
          </Copy>
          <Button secondary disabled={busy} onPress={() => setCancel(null)}>
            Back to schedule
          </Button>
        </>
      ) : (
        <>
          <Field
            label="Search drivers"
            value={driverQuery}
            editable={!busy}
            onChangeText={(v) => {
              setDriverQuery(v);
              form.setFieldValue("driver", "");
              setConflicts([]);
            }}
          />
          <Copy>Driver</Copy>
          {options.drivers.map((d) => (
            <Button
              key={d.id}
              secondary={driver !== d.id}
              disabled={busy}
              onPress={() => {
                form.setFieldValue("driver", d.id);
                setConflicts([]);
              }}
            >
              {`${d.name} · ${d.identifier}`}
            </Button>
          ))}
          <Field
            label="Search vehicles"
            value={truckQuery}
            editable={!busy}
            onChangeText={(v) => {
              setTruckQuery(v);
              form.setFieldValue("truck", "");
              setConflicts([]);
            }}
          />
          <Copy>Vehicle</Copy>
          {options.trucks.map((t) => (
            <TruckCard
              key={t.id}
              truck={t}
              selected={truck === t.id}
              onPress={
                busy
                  ? undefined
                  : () => {
                      form.setFieldValue("truck", t.id);
                      setConflicts([]);
                    }
              }
            />
          ))}
          <Copy>Repeat on</Copy>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
              (label, d) => (
                <Button
                  key={label}
                  secondary={!weekdays.includes(d)}
                  disabled={busy}
                  onPress={() => {
                    form.setFieldValue("weekdays", (v) =>
                      v.includes(d) ? v.filter((x) => x !== d) : [...v, d],
                    );
                    setConflicts([]);
                  }}
                >
                  {label}
                </Button>
              ),
            )}
          </View>
        </>
      )}
      {!!conflicts.length && (
        <Notice
          message={`${conflicts.length} conflicting assignments. Override replaces these dates: ${[...new Set(conflicts.map((c) => c.date))].join(", ")}`}
        />
      )}
      {conflicts.map((c) => (
        <Copy key={c.id} small>
          {c.date} · {c.driverName} · {c.registration}
        </Copy>
      ))}
      <form.Field name="note">
        {(field) => (
          <Field
            label={cancel || conflicts.length ? "Reason" : "Note (optional)"}
            value={field.state.value}
            onChangeText={field.handleChange}
            onBlur={field.handleBlur}
            editable={!busy}
            multiline
            maxLength={1000}
          />
        )}
      </form.Field>
      <Copy>Scheduled days</Copy>
      {items.length ? (
        items.map((item) => (
          <View key={item.id} style={styles.card}>
            <Copy>
              {item.date} · {item.registration}
            </Copy>
            <Copy small>{item.driverName}</Copy>
            <Button
              secondary
              disabled={busy}
              onPress={() => {
                setCancel(item);
                form.resetField("note");
                setConflicts([]);
              }}
            >
              Cancel day
            </Button>
          </View>
        ))
      ) : (
        <Copy small>No drivers scheduled.</Copy>
      )}
      <Notice message={validationError || action.error || error} />
    </Screen>
  );
}
