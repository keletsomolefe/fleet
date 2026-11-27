import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  Button,
  Chip,
  Copy,
  Field,
  Heading,
  Notice,
  PickerSheet,
  Screen,
  SelectField,
  colors,
  styles,
  useAction,
  type PickerOption,
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

const siteTypeLabels: Record<string, string> = {
  collection: "Collection site",
  delivery: "Delivery site",
  both: "Collection & delivery",
  fuel_station: "Fuel station",
  yard: "Yard",
};

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

function Choose({
  label,
  placeholder,
  value,
  items,
  optional = false,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: Ref;
  items: Entry[];
  optional?: boolean;
  onChange: (r: Ref) => void;
}) {
  const [open, setOpen] = useState(false);
  const options: PickerOption[] = items
    .filter((x) => x.active)
    .map((x) => ({
      id: x.id,
      label: x.name,
      subtitle: x.unit
        ? `Default unit: ${unitNames[x.unit] ?? x.unit}`
        : x.siteType
          ? (siteTypeLabels[x.siteType] ?? x.siteType)
          : undefined,
    }));

  return (
    <>
      <SelectField
        label={label}
        value={value.name}
        placeholder={placeholder ?? `Select ${label.toLowerCase()}`}
        onPress={() => setOpen(true)}
      />
      <PickerSheet
        visible={open}
        title={label}
        options={options}
        selectedId={value.id}
        placeholder={`Search ${label.toLowerCase()}…`}
        emptyMessage="No saved entries match. Type a name to add one."
        allowCustom
        onSelect={(opt) => onChange({ id: opt.id, name: opt.label })}
        onCustom={(text) => onChange({ id: null, name: text })}
        onClear={optional && value.name ? () => onChange(emptyRef) : undefined}
        onClose={() => setOpen(false)}
      />
    </>
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
  const [pickupSheetOpen, setPickupSheetOpen] = useState(false);
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

  const parsedRecords = records
    .map((r) => {
      try {
        return { id: r.id, data: JSON.parse(r.data) as Data };
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: string; data: Data } => Boolean(x));

  const deliveryCountByPickup = new Map<string, number>();
  for (const item of parsedRecords) {
    if (item.data.kind === "delivery" && item.data.runId) {
      deliveryCountByPickup.set(
        item.data.runId,
        (deliveryCountByPickup.get(item.data.runId) ?? 0) + 1,
      );
    }
  }

  const parsedCollections = parsedRecords
    .filter((x) => x.data.kind === "collection")
    .map((x) => ({
      ...x,
      deliveryCount: deliveryCountByPickup.get(x.id) ?? 0,
    }))
    .sort((a, b) => {
      const aDone = a.deliveryCount > 0 ? 1 : 0;
      const bDone = b.deliveryCount > 0 ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return b.data.occurredAt.localeCompare(a.data.occurredAt);
    })
    .slice(0, 15);

  const linkedPickup = form?.data.runId
    ? parsedCollections.find((col) => col.id === form.data.runId) ?? null
    : null;

  const pickupOptions: PickerOption[] = parsedCollections.map((col) => {
    const qty = col.data.quantity ? `${col.data.quantity} ${col.data.unit}` : col.data.unit;
    const product = col.data.product.name || "Load";
    const site = col.data.origin.name || "Pickup site";
    const customer = col.data.customer.name;
    const timeLabel = formatShortTime(col.data.occurredAt);
    const ticket = col.data.waybillNumber?.trim();
    const metaParts = [
      timeLabel,
      ticket ? `Ticket ${ticket}` : "",
    ].filter(Boolean);
    return {
      id: col.id,
      label: `${qty} ${product}`,
      subtitle: [site, customer].filter(Boolean).join(" · "),
      meta: metaParts.join(" · "),
      badge:
        col.deliveryCount === 0
          ? "Open load"
          : col.deliveryCount === 1
            ? "Delivered"
            : `${col.deliveryCount} deliveries`,
      badgeTone: col.deliveryCount === 0 ? "primary" : "muted",
      searchText: `${site} ${customer} ${product} ${ticket ?? ""} ${timeLabel}`,
    };
  });

  function linkPickupToForm(col: { id: string; data: Data }) {
    updateForm((d) => ({
      ...d,
      runId: col.id,
      customer: col.data.customer.name ? col.data.customer : d.customer,
      product: col.data.product.name ? col.data.product : d.product,
      origin: col.data.origin.name ? col.data.origin : d.origin,
      collectedQuantity: col.data.quantity ?? d.collectedQuantity,
      quantity:
        !d.quantity || (d.collectedQuantity && d.quantity === d.collectedQuantity)
          ? col.data.quantity
          : d.quantity,
      unit: col.data.unit || d.unit,
    }));
  }

  function startDeliveryFromPickup(col: { id: string; data: Data }) {
    startNew("delivery", {
      runId: col.id,
      dispatchId: col.data.dispatchId,
      customer: col.data.customer,
      supplier: col.data.supplier,
      product: col.data.product,
      origin: col.data.origin,
      quantity: col.data.quantity,
      collectedQuantity: col.data.quantity,
      unit: col.data.unit,
    });
  }

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
                    <Button
                      fill
                      secondary
                      disabled={!context}
                      onPress={() => startFromDispatch(job, "collection")}
                    >
                      Log pickup
                    </Button>
                    <Button
                      fill
                      disabled={!context}
                      onPress={() => startFromDispatch(job, "delivery", 0)}
                    >
                      Log delivery
                    </Button>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 2. Quick Ad-Hoc 2x2 Log Grid */}
          <View style={styles.group}>
            <Copy>Record activity</Copy>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button
                fill
                disabled={!context}
                onPress={() => startNew("collection")}
              >
                Pickup
              </Button>
              <Button
                fill
                disabled={!context}
                onPress={() => startNew("delivery")}
              >
                Delivery
              </Button>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button
                fill
                secondary
                disabled={!context}
                onPress={() => startNew("fuel")}
              >
                Fuel
              </Button>
              <Button
                fill
                secondary
                disabled={!context}
                onPress={() => startNew("expense")}
              >
                Road expense
              </Button>
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
                    <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
                      <Button
                        fill
                        secondary
                        disabled={!context}
                        onPress={() => {
                          setPhoto(null);
                          setForm({ recordId: rec.id, data: d! });
                        }}
                      >
                        Edit entry
                      </Button>
                      {d.kind === "collection" &&
                        (deliveryCountByPickup.get(rec.id) ?? 0) === 0 && (
                          <Button
                            fill
                            disabled={!context}
                            onPress={() =>
                              startDeliveryFromPickup({ id: rec.id, data: d! })
                            }
                          >
                            Log delivery
                          </Button>
                        )}
                    </View>
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
              {form.data.kind === "delivery" && parsedCollections.length > 0 && (
                <>
                  {linkedPickup ? (
                    <View
                      style={{
                        backgroundColor: colors.bg,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        padding: 12,
                        gap: 6,
                      }}
                    >
                      <Copy small>Linked pickup (auto-filled below)</Copy>
                      <Copy>
                        {`${linkedPickup.data.quantity ?? "?"} ${linkedPickup.data.unit} ${linkedPickup.data.product.name || "Load"} · ${linkedPickup.data.origin.name || "Pickup site"}`}
                      </Copy>
                      <Copy small>
                        {[
                          formatShortTime(linkedPickup.data.occurredAt),
                          linkedPickup.data.customer.name,
                          linkedPickup.data.waybillNumber?.trim()
                            ? `Ticket ${linkedPickup.data.waybillNumber.trim()}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Copy>
                      <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
                        <Button
                          fill
                          secondary
                          onPress={() => setPickupSheetOpen(true)}
                        >
                          Change pickup
                        </Button>
                        <Button
                          fill
                          secondary
                          onPress={() =>
                            updateForm((d) => ({
                              ...d,
                              runId: null,
                              collectedQuantity: null,
                            }))
                          }
                        >
                          Unlink
                        </Button>
                      </View>
                    </View>
                  ) : (
                    <SelectField
                      label="Link to recent pickup (optional)"
                      value=""
                      placeholder="Select a pickup to auto-fill load details"
                      hint="Open loads appear first with time and ticket number."
                      onPress={() => setPickupSheetOpen(true)}
                    />
                  )}
                  <PickerSheet
                    visible={pickupSheetOpen}
                    title="Link recent pickup"
                    subtitle="Pick a load to auto-fill customer, product, site and quantity."
                    options={pickupOptions}
                    selectedId={form.data.runId}
                    placeholder="Search by site, customer, product or ticket…"
                    emptyMessage="No matching recent pickups."
                    onSelect={(opt) => {
                      const col = parsedCollections.find((c) => c.id === opt.id);
                      if (col) linkPickupToForm(col);
                    }}
                    onClear={
                      form.data.runId
                        ? () =>
                            updateForm((d) => ({
                              ...d,
                              runId: null,
                              collectedQuantity: null,
                            }))
                        : undefined
                    }
                    onClose={() => setPickupSheetOpen(false)}
                  />
                </>
              )}

              <Choose
                label="Customer"
                placeholder="Select or add customer"
                items={catalogue.customers}
                value={form.data.customer}
                onChange={(customer) => updateForm((d) => ({ ...d, customer }))}
              />
              <Choose
                label="Product"
                placeholder="Select or add product"
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
                placeholder="Select pickup site"
                items={catalogue.locations}
                value={form.data.origin}
                onChange={(origin) => updateForm((d) => ({ ...d, origin }))}
              />
              {form.data.kind === "collection" && (
                <Choose
                  label="Supplier (optional)"
                  placeholder="Select supplier"
                  items={catalogue.customers}
                  optional
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
                    placeholder="Select drop-off site"
                    items={catalogue.locations}
                    value={form.data.destination}
                    onChange={(destination) =>
                      updateForm((d) => ({ ...d, destination }))
                    }
                  />
                  <Choose
                    label="Receiver (optional)"
                    placeholder="Select receiver"
                    items={catalogue.customers}
                    optional
                    value={form.data.receiver}
                    onChange={(receiver) =>
                      updateForm((d) => ({ ...d, receiver }))
                    }
                  />
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {catalogue.units.map((u) => (
                  <Chip
                    key={u}
                    selected={form.data.unit === u}
                    onPress={() => updateForm((d) => ({ ...d, unit: u }))}
                  >
                    {unitNames[u] ?? u}
                  </Chip>
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
                <Button
                  fill
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
                    : "Mark arrival"}
                </Button>
                <Button
                  fill
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
                    : "Mark left"}
                </Button>
              </View>

              {form.data.kind === "delivery" && (
                <>
                  <Copy small>Delivery outcome</Copy>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {(
                      [
                        ["completed", "Delivered"],
                        ["partial", "Part delivered"],
                        ["failed", "Could not deliver"],
                        ["cancelled", "Cancelled"],
                      ] as const
                    ).map(([val, label]) => (
                      <Chip
                        key={val}
                        selected={form.data.outcome === val}
                        onPress={() =>
                          updateForm((d) => ({ ...d, outcome: val }))
                        }
                      >
                        {label}
                      </Chip>
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(Object.keys(expenseCategoryLabels) as RoadExpenseCategory[]).map(
                  (cat) => (
                    <Chip
                      key={cat}
                      selected={form.data.expenseCategory === cat}
                      onPress={() =>
                        updateForm((d) => ({ ...d, expenseCategory: cat }))
                      }
                    >
                      {expenseCategoryLabels[cat]}
                    </Chip>
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
                <Button
                  fill
                  secondary
                  onPress={() => void handleAttachPhoto("camera")}
                >
                  Take photo
                </Button>
                <Button
                  fill
                  secondary
                  onPress={() => void handleAttachPhoto("library")}
                >
                  Gallery
                </Button>
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
