import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
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
import { pickPhoto, type CapturedPhoto } from "@/lib/photos";
import { activityOutbox } from "@/activities/db";
import {
  getActivitySyncStatus,
  refreshActivities,
  saveActivity,
  syncActivities,
  type Catalogue,
  type Entry,
  type Job,
} from "@/activities/service";
import type {
  ActivityKind,
  Context,
  Data,
  LocalRecord,
  Ref,
  RoadExpenseCategory,
} from "@/activities/queue";

const emptyRef: Ref = { id: null, name: "" };

const unitNames: Record<string, string> = {
  tonne: "Tonnes",
  kg: "Kilograms",
  litre: "Litres",
  m3: "Cubic metres",
  pallet: "Pallets",
  item: "Items",
};

const expenseCategoryLabels: Record<RoadExpenseCategory, string> = {
  toll: "Toll",
  repair: "Repair",
  tyres: "Tyres",
  weighbridge: "Weighbridge",
  parking: "Parking",
  permits: "Permits",
  other: "Other",
};

function fresh(kind: ActivityKind): Data {
  return {
    kind,
    occurredAt: new Date().toISOString(),
    arrivedAt: null,
    departedAt: null,
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
    grossWeight: null,
    tareWeight: null,
    waybillNumber: "",
    unit: "tonne",
    allocations: [],
    fuelLitres: null,
    fuelTotalCost: null,
    fuelStation: "",
    expenseCategory: kind === "expense" ? "toll" : null,
    expenseAmount: null,
    vendorName: "",
    receiptNumber: "",
    odometerKm: null,
    transportCharge: true,
    outcome: "completed",
    note: "",
    latitude: null,
    longitude: null,
    accuracy: null,
  };
}

function Choose({
  label,
  placeholder,
  value,
  items,
  onChange,
}: {
  label: string;
  placeholder?: string;
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
    .slice(0, 5);
  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        placeholder={placeholder}
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
  const router = useRouter();
  const { session, driver } = useFleet();
  const action = useAction();

  const [context, setContext] = useState<Context | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue>({
    customers: [],
    products: [],
    locations: [],
    customerProducts: [],
    units: Object.keys(unitNames),
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [syncState, setSyncState] = useState({
    pending: 0,
    blocked: 0,
    pendingPhotos: 0,
    syncing: false,
    lastSync: null as number | null,
    error: null as string | null,
  });

  const [form, setForm] = useState<{ recordId: string; data: Data } | null>(
    null,
  );
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [localError, setLocalError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");

  const driverId = driver?.driver.id;
  const draftKey = `activity:${session?.user.id ?? ""}`;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLocal = useCallback(async () => {
    if (!driverId) return;
    try {
      const q = await activityOutbox();
      const [activeCtx, cat, dispatches, recs, status, draft] =
        await Promise.all([
          q.active(),
          q.cached<Catalogue>(`catalogue:${driverId}`),
          q.cached<Job[]>(`jobs:${driverId}`),
          q.records(driverId),
          getActivitySyncStatus(),
          q.loadDraft<{ recordId: string; data: Data }>(draftKey),
        ]);
      setContext(activeCtx);
      if (cat) setCatalogue(cat);
      if (dispatches) setJobs(dispatches);
      setRecords(recs);
      setSyncState(status);
      if (draft) setForm((prev) => prev ?? draft);
    } catch {
      // ignore on web preview
    }
  }, [driverId, draftKey]);

  useEffect(() => {
    const initial = setTimeout(() => {
      void loadLocal();
      if (session && driverId) {
        void refreshActivities(session, driverId)
          .then(() => syncActivities())
          .then(() => loadLocal())
          .catch(() => undefined);
      }
    }, 0);
    const timer = setInterval(() => void loadLocal(), 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [driverId, loadLocal, session]);

  function updateForm(updater: (prev: Data) => Data) {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, data: updater(prev.data) };
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        void activityOutbox()
          .then((q) => q.saveDraft(draftKey, next))
          .catch(() => undefined);
      }, 300);
      return next;
    });
  }

  function startNew(kind: ActivityKind, preset?: Partial<Data>, recordId?: string) {
    setLocalError("");
    setSavedNotice("");
    setPhoto(null);
    setForm({
      recordId: recordId ?? Crypto.randomUUID(),
      data: { ...fresh(kind), ...preset },
    });
  }

  function startFromDispatch(job: Job, kind: "collection" | "delivery", stopIndex = 0) {
    const stop = job.plan.deliveries[stopIndex];
    if (kind === "collection") {
      startNew(
        "collection",
        {
          dispatchId: job.id,
          customer: job.plan.customer,
          supplier: job.plan.supplier,
          product: job.plan.product,
          origin: job.plan.origin,
          quantity: job.plan.quantity,
          unit: job.plan.unit,
          allocations:
            job.plan.deliveries.length > 1
              ? job.plan.deliveries.map((d) => ({
                  deliveryId: d.id,
                  quantity: d.collectedQuantity ?? d.quantity,
                }))
              : [],
        },
        job.plan.collectionId,
      );
      return;
    }
    startNew(
      "delivery",
      {
        dispatchId: job.id,
        runId: job.plan.collectionId,
        customer: job.plan.customer,
        supplier: job.plan.supplier,
        receiver: stop?.receiver ?? emptyRef,
        product: job.plan.product,
        origin: job.plan.origin,
        destination: stop?.destination ?? emptyRef,
        quantity: stop?.quantity ?? job.plan.quantity,
        collectedQuantity: stop?.collectedQuantity ?? job.plan.quantity,
        unit: job.plan.unit,
      },
      stop?.id,
    );
  }

  async function handleAttachPhoto(source: "camera" | "library") {
    setLocalError("");
    try {
      const captured = await pickPhoto(source);
      if (captured) setPhoto(captured);
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "Could not capture photo.",
      );
    }
  }

  async function submit() {
    if (!form) return;
    if (!context) {
      setLocalError("Confirm your vehicle online before recording.");
      return;
    }
    setLocalError("");
    const d = form.data;
    if (d.kind === "fuel" && !d.fuelLitres) {
      setLocalError("Enter fuel litres.");
      return;
    }
    if (d.kind === "expense" && !d.expenseAmount) {
      setLocalError("Enter the expense amount in Rand.");
      return;
    }
    if (
      (d.kind === "collection" || d.kind === "delivery") &&
      !d.customer.name.trim() &&
      !d.product.name.trim()
    ) {
      setLocalError("Enter at least the customer or product.");
      return;
    }

    const attachmentKind =
      d.kind === "fuel"
        ? "fuel_receipt"
        : d.kind === "expense"
          ? "expense_receipt"
          : d.kind === "collection"
            ? "weighbridge_ticket"
            : "pod";

    await saveActivity(
      context.id,
      form.recordId,
      { ...d, occurredAt: d.occurredAt || new Date().toISOString() },
      photo ? { file: photo, kind: attachmentKind } : null,
    );
    const q = await activityOutbox();
    await q.saveDraft(draftKey, null);
    setForm(null);
    setPhoto(null);
    setSavedNotice("Saved safely. Syncing with office…");
    await loadLocal();
  }

  async function syncNow() {
    setSavedNotice("");
    if (session && driver?.driver.id) {
      await refreshActivities(session, driver.driver.id).catch(() => undefined);
    }
    await syncActivities(true);
    await loadLocal();
  }

  const parsedCollections = records
    .map((r) => {
      try {
        return { id: r.id, data: JSON.parse(r.data) as Data };
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: string; data: Data } =>
      Boolean(x && x.data.kind === "collection"),
    )
    .slice(0, 6);

  return (
    <Screen
      actions={
        <Button secondary onPress={() => router.back()}>
          Back to vehicle
        </Button>
      }
    >
      <Heading
        title="Jobs & activity"
        detail={
          driver?.drivingSession?.startOdometerKm
            ? `Shift started at ${Number(driver.drivingSession.startOdometerKm).toLocaleString()} km`
            : "Log pickups, drop-offs, petrol and road costs. Works offline."
        }
      />

      <View style={styles.card}>
        <Copy>
          {syncState.pending > 0
            ? `${syncState.pending} item${syncState.pending === 1 ? "" : "s"} saved offline — waiting to sync`
            : "All activity synced"}
        </Copy>
        {syncState.blocked > 0 && (
          <Copy small>
            {syncState.blocked} item{syncState.blocked === 1 ? "" : "s"} need
            attention — check entries below.
          </Copy>
        )}
        {syncState.lastSync && (
          <Copy small>
            Last synced: {new Date(syncState.lastSync).toLocaleTimeString()}
          </Copy>
        )}
        <Button
          secondary
          loading={action.busy || syncState.syncing}
          onPress={() => void action.run(syncNow)}
        >
          Sync now
        </Button>
      </View>

      {!context && (
        <Notice
          title="Vehicle session needed"
          message="Return to your vehicle screen and confirm your vehicle online to start recording."
        />
      )}
      <Notice message={localError || action.error || syncState.error || undefined} />
      {!!savedNotice && (
        <View style={styles.card}>
          <Copy>{savedNotice}</Copy>
        </View>
      )}

      {!form ? (
        <>
          {/* 1. Assigned Dispatches at Top */}
          {jobs.length > 0 && (
            <View style={styles.group}>
              <Copy>Assigned dispatches ({jobs.length})</Copy>
              {jobs.map((job) => (
                <View key={job.id} style={styles.card}>
                  <Copy>
                    {job.reference} · {job.plan.customer.name || "Customer"}
                  </Copy>
                  <Copy small>
                    {job.plan.origin.name || "Pickup"} →{" "}
                    {job.plan.deliveries
                      .map((d) => d.destination.name || "Drop-off")
                      .join(", ")}
                  </Copy>
                  <Copy small>
                    {job.plan.quantity} {job.plan.unit} {job.plan.product.name}
                    {job.plan.instructions ? ` · ${job.plan.instructions}` : ""}
                  </Copy>
                  <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        secondary
                        disabled={!context}
                        onPress={() => startFromDispatch(job, "collection")}
                      >
                        Log pickup
                      </Button>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        disabled={!context}
                        onPress={() => startFromDispatch(job, "delivery", 0)}
                      >
                        Log delivery
                      </Button>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 2. Quick Ad-Hoc 2x2 Log Grid */}
          <View style={styles.group}>
            <Copy>Record activity</Copy>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  disabled={!context}
                  onPress={() => startNew("collection")}
                >
                  Pickup / Load
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  disabled={!context}
                  onPress={() => startNew("delivery")}
                >
                  Delivery / Offload
                </Button>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  secondary
                  disabled={!context}
                  onPress={() => startNew("fuel")}
                >
                  Petrol / Fuel
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  secondary
                  disabled={!context}
                  onPress={() => startNew("expense")}
                >
                  Road expense
                </Button>
              </View>
            </View>
          </View>

          {/* 3. Recent Logged Entries */}
          {records.length > 0 && (
            <View style={styles.group}>
              <Copy>Recent entries ({records.length})</Copy>
              {records.map((rec) => {
                let d: Data | null = null;
                try {
                  d = JSON.parse(rec.data) as Data;
                } catch {
                  d = null;
                }
                if (!d) return null;
                const syncBadge = rec.blocked_reason
                  ? `Issue: ${rec.blocked_reason}`
                  : rec.acknowledged_at
                    ? rec.review === "validated"
                      ? "Validated"
                      : rec.review === "clarification"
                        ? "Office asked for clarification"
                        : "Synced"
                    : "Saved offline";
                return (
                  <View key={rec.id} style={styles.card}>
                    <Copy>
                      {d.kind === "collection"
                        ? `Pickup · ${d.quantity ?? "?"} ${d.unit} ${d.product.name || ""}`
                        : d.kind === "delivery"
                          ? `Delivery · ${d.quantity ?? "?"} ${d.unit} ${d.product.name || ""}`
                          : d.kind === "fuel"
                            ? `Fuel · ${d.fuelLitres ?? "?"} L${d.fuelTotalCost ? ` · R${d.fuelTotalCost}` : ""}`
                            : `${expenseCategoryLabels[d.expenseCategory ?? "other"]} · R${d.expenseAmount ?? "?"}`}
                    </Copy>
                    <Copy small>
                      {d.kind === "collection"
                        ? `${d.customer.name || "Customer"} · ${d.origin.name || "Site"}`
                        : d.kind === "delivery"
                          ? `${d.customer.name || "Customer"} · ${d.destination.name || "Site"}`
                          : d.kind === "fuel"
                            ? d.fuelStation || "Fuel stop"
                            : d.vendorName || "Road expense"}
                    </Copy>
                    <Copy small>
                      {syncBadge} · {new Date(d.occurredAt).toLocaleString()}
                    </Copy>
                    <Button
                      secondary
                      disabled={!context}
                      onPress={() => {
                        setPhoto(null);
                        setForm({ recordId: rec.id, data: d! });
                      }}
                    >
                      Edit entry
                    </Button>
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : (
        /* Active Logging Form */
        <View style={styles.card}>
          <Heading
            title={
              form.data.kind === "collection"
                ? "Record pickup / collection"
                : form.data.kind === "delivery"
                  ? "Record delivery / offload"
                  : form.data.kind === "fuel"
                    ? "Record petrol / fuel"
                    : "Record road expense"
            }
          />

          {(form.data.kind === "collection" ||
            form.data.kind === "delivery") && (
            <>
              <Choose
                label="Customer"
                placeholder="Type or select customer"
                items={catalogue.customers}
                value={form.data.customer}
                onChange={(customer) => updateForm((d) => ({ ...d, customer }))}
              />
              <Choose
                label="Product"
                placeholder="e.g. Chrome ore, Coal, Sand"
                items={catalogue.products}
                value={form.data.product}
                onChange={(product) => {
                  const found = catalogue.products.find(
                    (p) => p.id === product.id,
                  );
                  updateForm((d) => ({
                    ...d,
                    product,
                    unit: found?.unit ?? d.unit,
                  }));
                }}
              />
              <Choose
                label="Collection / pickup site"
                placeholder="Where did you collect?"
                items={catalogue.locations}
                value={form.data.origin}
                onChange={(origin) => updateForm((d) => ({ ...d, origin }))}
              />
              {form.data.kind === "collection" && (
                <Choose
                  label="Supplier (optional)"
                  placeholder="Who supplied the load?"
                  items={catalogue.customers}
                  value={form.data.supplier}
                  onChange={(supplier) =>
                    updateForm((d) => ({ ...d, supplier }))
                  }
                />
              )}
              {form.data.kind === "delivery" && (
                <>
                  <Choose
                    label="Delivery / drop-off site"
                    placeholder="Where did you deliver?"
                    items={catalogue.locations}
                    value={form.data.destination}
                    onChange={(destination) =>
                      updateForm((d) => ({ ...d, destination }))
                    }
                  />
                  <Choose
                    label="Receiver (optional)"
                    placeholder="Who received the load?"
                    items={catalogue.customers}
                    value={form.data.receiver}
                    onChange={(receiver) =>
                      updateForm((d) => ({ ...d, receiver }))
                    }
                  />
                  {parsedCollections.length > 0 && !form.data.runId && (
                    <View style={{ gap: 6 }}>
                      <Copy small>Link to a recent pickup (optional)</Copy>
                      {parsedCollections.map((col) => (
                        <Button
                          key={col.id}
                          secondary
                          onPress={() =>
                            updateForm((d) => ({
                              ...d,
                              runId: col.id,
                              customer: d.customer.name
                                ? d.customer
                                : col.data.customer,
                              product: d.product.name
                                ? d.product
                                : col.data.product,
                              origin: d.origin.name ? d.origin : col.data.origin,
                              collectedQuantity:
                                d.collectedQuantity ?? col.data.quantity,
                              unit: col.data.unit,
                            }))
                          }
                        >
                          {`${col.data.quantity ?? "?"} ${col.data.unit} ${col.data.product.name || "load"} from ${col.data.origin.name || "site"}`}
                        </Button>
                      ))}
                    </View>
                  )}
                </>
              )}

              <Field
                label={
                  form.data.kind === "collection"
                    ? "Collected quantity (e.g. tonnes)"
                    : "Delivered quantity (e.g. tonnes)"
                }
                keyboardType="decimal-pad"
                placeholder="e.g. 34.2"
                value={form.data.quantity ?? ""}
                onChangeText={(v) =>
                  updateForm((d) => ({ ...d, quantity: v.trim() || null }))
                }
              />

              <Copy small>Unit</Copy>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {catalogue.units.map((u) => (
                  <Button
                    key={u}
                    secondary={form.data.unit !== u}
                    selected={form.data.unit === u}
                    onPress={() => updateForm((d) => ({ ...d, unit: u }))}
                  >
                    {unitNames[u] ?? u}
                  </Button>
                ))}
              </View>

              <Field
                label="Waybill / POD / Weighbridge ticket # (optional)"
                placeholder="e.g. WB-10428"
                value={form.data.waybillNumber}
                onChangeText={(waybillNumber) =>
                  updateForm((d) => ({ ...d, waybillNumber }))
                }
              />

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    onPress={() =>
                      updateForm((d) => ({
                        ...d,
                        arrivedAt: new Date().toISOString(),
                      }))
                    }
                  >
                    {form.data.arrivedAt
                      ? `Arrived ${new Date(form.data.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Stamp arrival"}
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    onPress={() =>
                      updateForm((d) => ({
                        ...d,
                        departedAt: new Date().toISOString(),
                      }))
                    }
                  >
                    {form.data.departedAt
                      ? `Left ${new Date(form.data.departedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Stamp departure"}
                  </Button>
                </View>
              </View>

              {form.data.kind === "delivery" && (
                <>
                  <Copy small>Delivery outcome</Copy>
                  <View style={{ gap: 6 }}>
                    {(
                      [
                        ["completed", "Delivered"],
                        ["partial", "Part delivered"],
                        ["failed", "Could not deliver"],
                        ["cancelled", "Cancelled"],
                      ] as const
                    ).map(([val, label]) => (
                      <Button
                        key={val}
                        secondary={form.data.outcome !== val}
                        selected={form.data.outcome === val}
                        onPress={() =>
                          updateForm((d) => ({ ...d, outcome: val }))
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {form.data.kind === "fuel" && (
            <>
              <Field
                label="Fuel litres"
                keyboardType="decimal-pad"
                placeholder="e.g. 420.5"
                value={form.data.fuelLitres ?? ""}
                onChangeText={(v) =>
                  updateForm((d) => ({ ...d, fuelLitres: v.trim() || null }))
                }
              />
              <Field
                label="Total paid (Rand)"
                keyboardType="decimal-pad"
                placeholder="e.g. 9450.00"
                value={form.data.fuelTotalCost ?? ""}
                onChangeText={(v) =>
                  updateForm((d) => ({ ...d, fuelTotalCost: v.trim() || null }))
                }
              />
              <Field
                label="Fuel station / depot (optional)"
                placeholder="e.g. Engen Middelburg N4"
                value={form.data.fuelStation}
                onChangeText={(fuelStation) =>
                  updateForm((d) => ({ ...d, fuelStation }))
                }
              />
              <Field
                label="Receipt # (optional)"
                value={form.data.receiptNumber}
                onChangeText={(receiptNumber) =>
                  updateForm((d) => ({ ...d, receiptNumber }))
                }
              />
            </>
          )}

          {form.data.kind === "expense" && (
            <>
              <Copy small>Expense category</Copy>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {(Object.keys(expenseCategoryLabels) as RoadExpenseCategory[]).map(
                  (cat) => (
                    <Button
                      key={cat}
                      secondary={form.data.expenseCategory !== cat}
                      selected={form.data.expenseCategory === cat}
                      onPress={() =>
                        updateForm((d) => ({ ...d, expenseCategory: cat }))
                      }
                    >
                      {expenseCategoryLabels[cat]}
                    </Button>
                  ),
                )}
              </View>
              <Field
                label="Amount paid (Rand)"
                keyboardType="decimal-pad"
                placeholder="e.g. 385.00"
                value={form.data.expenseAmount ?? ""}
                onChangeText={(v) =>
                  updateForm((d) => ({ ...d, expenseAmount: v.trim() || null }))
                }
              />
              <Field
                label="Toll plaza / workshop / vendor"
                placeholder="e.g. Middelburg Toll Plaza"
                value={form.data.vendorName}
                onChangeText={(vendorName) =>
                  updateForm((d) => ({ ...d, vendorName }))
                }
              />
              <Field
                label="Receipt / slip # (optional)"
                value={form.data.receiptNumber}
                onChangeText={(receiptNumber) =>
                  updateForm((d) => ({ ...d, receiptNumber }))
                }
              />
            </>
          )}

          <Field
            label="Odometer reading km (optional)"
            keyboardType="decimal-pad"
            placeholder="e.g. 284690"
            value={form.data.odometerKm ?? ""}
            onChangeText={(v) =>
              updateForm((d) => ({ ...d, odometerKm: v.trim() || null }))
            }
          />

          <View style={{ gap: 8 }}>
            <Copy small>
              {form.data.kind === "fuel"
                ? "Fuel slip photo (optional)"
                : form.data.kind === "expense"
                  ? "Receipt photo (optional)"
                  : form.data.kind === "collection"
                    ? "Weighbridge slip photo (optional)"
                    : "Signed POD / waybill photo (optional)"}
            </Copy>
            {photo ? (
              <View style={{ gap: 8 }}>
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: "100%", height: 160, borderRadius: 8 }}
                  contentFit="cover"
                />
                <Button secondary onPress={() => setPhoto(null)}>
                  Remove photo
                </Button>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    onPress={() => void handleAttachPhoto("camera")}
                  >
                    Take photo
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    onPress={() => void handleAttachPhoto("library")}
                  >
                    Gallery
                  </Button>
                </View>
              </View>
            )}
          </View>

          <Field
            label="Notes (optional)"
            multiline
            value={form.data.note}
            onChangeText={(note) => updateForm((d) => ({ ...d, note }))}
          />

          <Button
            loading={action.busy}
            disabled={!context}
            onPress={() => void action.run(submit)}
          >
            Save activity
          </Button>
          <Button
            secondary
            onPress={() => {
              setForm(null);
              setPhoto(null);
              void activityOutbox()
                .then((q) => q.saveDraft(draftKey, null))
                .catch(() => undefined);
            }}
          >
            Cancel
          </Button>
        </View>
      )}
    </Screen>
  );
}
