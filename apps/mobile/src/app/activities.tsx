import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  Button,
  Copy,
  Field,
  Heading,
  Notice,
  Screen,
  styles,
  useAction,
} from "@/components/ui";
import { useFleet } from "@/state/fleet";
import { activityOutbox } from "@/activities/db";
import {
  refreshActivities,
  saveActivity,
  syncActivities,
  type Catalogue,
  type Entry,
  type Job,
} from "@/activities/service";
import type { Context, Data, LocalRecord, Ref } from "@/activities/queue";

const emptyRef: Ref = { id: null, name: "" };
const fresh = (kind: Data["kind"]): Data => ({
  kind,
  occurredAt: new Date().toISOString(),
  dispatchId: null,
  runId: null,
  customer: emptyRef,
  product: emptyRef,
  supplier: emptyRef,
  receiver: emptyRef,
  origin: emptyRef,
  destination: emptyRef,
  quantity: null,
  collectedQuantity: null,
  unit: "tonne",
  allocations: [],
  fuelLitres: null,
  fuelTotalCost: null,
  odometerKm: null,
  transportCharge: true,
  outcome: "completed",
  note: "",
  latitude: null,
  longitude: null,
  accuracy: null,
});
const unitNames: Record<string, string> = {
  tonne: "Tonnes",
  kg: "Kilograms",
  litre: "Litres",
  m3: "Cubic metres",
  pallet: "Pallets",
  item: "Items",
};
function ActivityTime({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [entered, setEntered] = useState(() =>
    new Date(Date.parse(value) + 7200000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " "),
  );
  return (
    <Field
      label="Date and time"
      placeholder="2026-10-26 16:30"
      value={entered}
      onChangeText={(v) => {
        setEntered(v);
        const time = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)
          ? Date.parse(v.replace(" ", "T") + "+02:00")
          : NaN;
        onChange(Number.isFinite(time) ? new Date(time).toISOString() : v);
      }}
    />
  );
}
function Choose({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: Ref;
  items: Entry[];
  onChange: (r: Ref) => void;
}) {
  const [open, setOpen] = useState(false);
  const matches = items
    .filter(
      (x) =>
        x.active && x.name.toLowerCase().includes(value.name.toLowerCase()),
    )
    .slice(0, 4);
  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        value={value.name}
        onChangeText={(name) => {
          onChange({ id: null, name });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open &&
        !value.id &&
        matches.map((x) => (
          <Button
            key={x.id}
            secondary
            onPress={() => {
              onChange({ id: x.id, name: x.name });
              setOpen(false);
            }}
          >
            {x.name}
          </Button>
        ))}
    </View>
  );
}
export default function Activities() {
  const { session, driver } = useFleet(),
    action = useAction();
  const [context, setContext] = useState<Context | null>(null),
    [catalogue, setCatalogue] = useState<Catalogue>({
      customers: [],
      products: [],
      locations: [],
      customerProducts: [],
      units: Object.keys(unitNames),
    }),
    [jobs, setJobs] = useState<Job[]>([]),
    [records, setRecords] = useState<LocalRecord[]>([]),
    [status, setStatus] = useState<{
      pending?: number;
      syncing?: boolean;
      blocked?: number;
      lastSync: number | null;
      error: string | null;
    }>({ lastSync: null, error: null }),
    [form, setForm] = useState<{ recordId: string; data: Data } | null>(null),
    [loaded, setLoaded] = useState(false),
    [localError, setLocalError] = useState("");
  const draftKey = `activity:${session?.user.id ?? ""}`,
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    const q = await activityOutbox(),
      active = await q.active();
    setContext(active);
    setStatus(await q.status());
    if (driver) {
      setRecords(await q.records(driver.driver.id));
      setCatalogue(
        (await q.cached<Catalogue>(`catalogue:${driver.driver.id}`)) ?? {
          customers: [],
          products: [],
          locations: [],
          customerProducts: [],
          units: Object.keys(unitNames),
        },
      );
      setJobs((await q.cached<Job[]>(`jobs:${driver.driver.id}`)) ?? []);
    }
  }, [driver]);
  useEffect(() => {
    void (async () => {
      const q = await activityOutbox();
      setForm(await q.draft(draftKey));
      setLoaded(true);
    })().catch((e) => setLocalError(e.message));
  }, [draftKey]);
  useEffect(() => {
    const initial = setTimeout(
      () => void refresh().catch((e) => setLocalError(e.message)),
      0,
    );
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!loaded) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void activityOutbox()
        .then(async (q) => {
          if (form) await q.draft(draftKey, form);
          else await q.clearDraft(draftKey);
        })
        .catch(() => {});
    }, 250);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [form, loaded, draftKey]);
  const change = (key: keyof Data, value: unknown) =>
    setForm((f) => (f ? { ...f, data: { ...f.data, [key]: value } } : f));
  function fromJob(job: Job, line?: Job["plan"]["deliveries"][number]) {
    const data = {
      ...fresh(line ? "delivery" : "collection"),
      dispatchId: job.id,
      runId: line ? job.plan.collectionId : null,
      customer: job.plan.customer,
      product: job.plan.product,
      supplier: job.plan.supplier,
      origin: job.plan.origin,
      unit: job.plan.unit,
      quantity: line?.quantity ?? job.plan.quantity,
      collectedQuantity: line?.collectedQuantity ?? null,
      destination: line?.destination ?? emptyRef,
      receiver: line?.receiver ?? emptyRef,
      allocations: line
        ? []
        : job.plan.deliveries.map((x) => ({
            deliveryId: x.id,
            quantity: x.collectedQuantity ?? x.quantity,
          })),
      note: "",
    };
    const recordId = line?.id ?? job.plan.collectionId;
    const old = records.find((r) => r.id === recordId);
    setForm({ recordId, data: old ? (JSON.parse(old.data) as Data) : data });
  }
  async function submit() {
    if (!form) return;
    for (const key of [
      "quantity",
      "collectedQuantity",
      "fuelLitres",
      "fuelTotalCost",
      "odometerKm",
    ] as const)
      if (form.data[key] && !/^\d{1,12}(\.\d{1,6})?$/.test(form.data[key]!))
        throw new Error("Check the quantity and amount.");
    if (!Number.isFinite(Date.parse(form.data.occurredAt)))
      throw new Error("Check the activity time.");
    await saveActivity(form.recordId, form.data);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    await (await activityOutbox()).clearDraft(draftKey);
    setForm(null);
    await refresh();
  }
  return (
    <Screen
      actions={
        <>
          <Button
            secondary
            loading={action.busy}
            onPress={() =>
              void action.run(async () => {
                await syncActivities(true);
                if (session && driver)
                  await refreshActivities(session, driver.driver.id);
                await refresh();
              })
            }
          >
            Sync now
          </Button>
          <Button secondary onPress={() => setForm(null)}>
            Activity history
          </Button>
        </>
      }
    >
      <Heading title="Your activity" />
      <Copy small>
        {status.syncing ? "Syncing · " : ""}
        {status.pending ?? 0} waiting to sync · {status.blocked ?? 0} need
        attention
      </Copy>
      {status.lastSync && (
        <Copy small>
          Last synced {new Date(status.lastSync).toLocaleString("en-ZA")}
        </Copy>
      )}
      <Notice
        message={action.error || localError || status.error || undefined}
      />
      {!context && (
        <Notice
          title="Confirm your vehicle"
          message="Connect and confirm your vehicle to start recording."
        />
      )}
      {context &&
        context.confirmedDate !==
          new Date().toLocaleDateString("en-CA", {
            timeZone: "Africa/Johannesburg",
          }) && (
          <Notice
            title="Vehicle confirmation pending"
            message="You can keep recording. Your office will check the vehicle allocation."
          />
        )}
      {!form && (
        <>
          <View style={styles.group}>
            {(["collection", "delivery", "fuel"] as const).map((kind) => (
              <Button
                key={kind}
                disabled={!context}
                onPress={() =>
                  setForm({ recordId: Crypto.randomUUID(), data: fresh(kind) })
                }
              >
                {kind === "collection"
                  ? "Log collection"
                  : kind === "delivery"
                    ? "Log offloading"
                    : "Log fuel"}
              </Button>
            ))}
          </View>
          {jobs.map((job) => (
            <View key={job.id} style={styles.card}>
              <Heading title={job.reference} />
              {job.allocationConflict && (
                <Notice
                  title="Job allocation needs review"
                  message="Record the work you carry out."
                />
              )}
              <Copy>
                {job.date} · {job.plan.product.name}
              </Copy>
              <Copy small>{job.plan.instructions}</Copy>
              <Button
                secondary
                disabled={!context}
                onPress={() => fromJob(job)}
              >{`Collection · ${job.plan.origin.name}`}</Button>
              {job.plan.deliveries.map((line) => (
                <Button
                  key={line.id}
                  secondary
                  disabled={!context}
                  onPress={() => fromJob(job, line)}
                >{`Offload · ${line.destination.name}`}</Button>
              ))}
            </View>
          ))}
          {records.map((r) => {
            const d = JSON.parse(r.data) as Data;
            return (
              <View key={r.id} style={styles.card}>
                <Copy>
                  {d.kind === "fuel"
                    ? "Fuel"
                    : d.kind === "delivery"
                      ? "Offloading"
                      : "Collection"}{" "}
                  · {d.product.name || d.fuelLitres || "—"}
                </Copy>
                <Copy small>
                  {new Date(d.occurredAt).toLocaleString("en-ZA")} ·{" "}
                  {r.blocked_reason
                    ? "Needs attention"
                    : r.acknowledged_at
                      ? "Synced"
                      : "Saved on phone"}{" "}
                  ·{" "}
                  {r.review === "validated"
                    ? "Validated"
                    : r.review === "clarification"
                      ? "Clarification requested"
                      : r.review === "void"
                        ? "Voided"
                        : "Awaiting review"}
                </Copy>
                {r.blocked_reason && <Notice message={r.blocked_reason} />}
                <Button
                  secondary
                  disabled={!context}
                  onPress={() => setForm({ recordId: r.id, data: d })}
                >
                  Correct entry
                </Button>
                {r.blocked_reason && (
                  <Button
                    secondary
                    onPress={() =>
                      void action.run(async () => {
                        await (await activityOutbox()).retry(r.id);
                        await syncActivities(true);
                        await refresh();
                      })
                    }
                  >
                    Retry sync
                  </Button>
                )}
              </View>
            );
          })}
        </>
      )}
      {form && (
        <View style={styles.group}>
          <Heading
            title={
              form.data.kind === "fuel"
                ? "Log fuel"
                : form.data.kind === "collection"
                  ? "Record collection"
                  : "Record offloading"
            }
          />
          <ActivityTime
            key={form.recordId}
            value={form.data.occurredAt}
            onChange={(v) => change("occurredAt", v)}
          />
          {form.data.kind !== "fuel" ? (
            <>
              <Choose
                label="Paying customer"
                items={catalogue.customers}
                value={form.data.customer}
                onChange={(v) => change("customer", v)}
              />
              <Choose
                label="Product"
                items={catalogue.products}
                value={form.data.product}
                onChange={(v) => {
                  change("product", v);
                  const p = catalogue.products.find((x) => x.id === v.id);
                  if (p?.unit) change("unit", p.unit);
                }}
              />
              <Choose
                label="Supplier"
                items={catalogue.customers}
                value={form.data.supplier}
                onChange={(v) => change("supplier", v)}
              />
              <Choose
                label="Collection site"
                items={catalogue.locations}
                value={form.data.origin}
                onChange={(v) => change("origin", v)}
              />
              {form.data.kind === "delivery" && (
                <>
                  <Choose
                    label="Receiving customer"
                    items={catalogue.customers}
                    value={form.data.receiver}
                    onChange={(v) => change("receiver", v)}
                  />
                  <Choose
                    label="Delivery site"
                    items={catalogue.locations}
                    value={form.data.destination}
                    onChange={(v) => change("destination", v)}
                  />
                  {records
                    .filter((r) => {
                      const d = JSON.parse(r.data) as Data;
                      return (
                        d.kind === "collection" &&
                        d.product.name === form.data.product.name
                      );
                    })
                    .slice(0, 5)
                    .map((r) => (
                      <Button
                        key={r.id}
                        secondary
                        onPress={() => change("runId", r.id)}
                      >{`${form.data.runId === r.id ? "Linked collection" : "Link collection"} · ${new Date((JSON.parse(r.data) as Data).occurredAt).toLocaleDateString("en-ZA")}`}</Button>
                    ))}
                  <Field
                    label="Collected share for this delivery"
                    keyboardType="decimal-pad"
                    value={form.data.collectedQuantity ?? ""}
                    onChangeText={(v) => change("collectedQuantity", v || null)}
                  />
                </>
              )}
              <Field
                label={
                  form.data.kind === "collection"
                    ? "Actual collected"
                    : "Actual delivered"
                }
                keyboardType="decimal-pad"
                value={form.data.quantity ?? ""}
                onChangeText={(v) => change("quantity", v || null)}
              />
              <Copy small>Unit</Copy>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {catalogue.units.map((u) => (
                  <Button
                    key={u}
                    secondary={form.data.unit !== u}
                    onPress={() => change("unit", u)}
                  >
                    {unitNames[u] ?? u}
                  </Button>
                ))}
              </View>
              {form.data.allocations.map((a, i) => (
                <Field
                  key={a.deliveryId}
                  label={`Loaded share · delivery ${i + 1}`}
                  keyboardType="decimal-pad"
                  value={a.quantity}
                  onChangeText={(v) =>
                    change(
                      "allocations",
                      form.data.allocations.map((x) =>
                        x.deliveryId === a.deliveryId
                          ? { ...x, quantity: v }
                          : x,
                      ),
                    )
                  }
                />
              ))}
              {form.data.kind === "delivery" && (
                <>
                  <Copy small>Outcome</Copy>
                  {["completed", "partial", "failed", "cancelled"].map((v) => (
                    <Button
                      key={v}
                      secondary={form.data.outcome !== v}
                      onPress={() => change("outcome", v)}
                    >
                      {v === "completed"
                        ? "Delivered"
                        : v === "partial"
                          ? "Part delivered"
                          : v === "failed"
                            ? "Could not deliver"
                            : "Cancelled"}
                    </Button>
                  ))}
                  <Button
                    secondary
                    onPress={() =>
                      change("transportCharge", !form.data.transportCharge)
                    }
                  >
                    {form.data.transportCharge
                      ? "Transport charge applies"
                      : "No transport charge"}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              {(["fuelLitres", "fuelTotalCost", "odometerKm"] as const).map(
                (k) => (
                  <Field
                    key={k}
                    label={
                      k === "fuelLitres"
                        ? "Fuel litres"
                        : k === "fuelTotalCost"
                          ? "Total paid (R)"
                          : "Odometer (km)"
                    }
                    keyboardType="decimal-pad"
                    value={form.data[k] ?? ""}
                    onChangeText={(v) => change(k, v || null)}
                  />
                ),
              )}
            </>
          )}
          {catalogue.locations
            .filter(
              (x) =>
                x.id === form.data.destination.id ||
                x.id === form.data.origin.id,
            )
            .map((x) => (
              <View key={x.id} style={styles.card}>
                <Copy>{x.name}</Copy>
                <Copy small>{x.directions}</Copy>
                {x.latitude != null && (
                  <Copy small>
                    {x.latitude}, {x.longitude}
                  </Copy>
                )}
              </View>
            ))}
          <Field
            label="Notes / reason for changes"
            multiline
            value={form.data.note}
            onChangeText={(v) => change("note", v)}
          />
          <Button
            loading={action.busy}
            disabled={!context}
            onPress={() => void action.run(submit)}
          >
            Save activity
          </Button>
          <Button secondary onPress={() => setForm(null)}>
            Close
          </Button>
        </View>
      )}
    </Screen>
  );
}
