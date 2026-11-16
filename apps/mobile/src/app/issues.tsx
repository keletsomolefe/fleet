import { useForm, useStore } from "@tanstack/react-form";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
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
import { ApiError, request } from "@/lib/api";
import {
  type DriverIssue,
  type IssueCategory,
  type ReportResult,
  type ServiceType,
  issueLabels,
  jobStatusLabel,
  serviceTypeLabels,
  serviceTypes,
} from "@/lib/issues";
import { useFleet } from "@/state/fleet";

type Submission = {
  id: string;
  truckId: string | null;
  category: IssueCategory;
  serviceType?: ServiceType;
  description: string;
  locationText?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracyM?: number | null;
  locationCapturedAt?: string | null;
};

async function shareLocation(locationText: string) {
  const base = locationText.trim() ? { locationText: locationText.trim() } : {};
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted")
      permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return base;
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 300_000,
      requiredAccuracy: 1000,
    });
    const position =
      last ??
      (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }));
    return {
      ...base,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      locationAccuracyM: position.coords.accuracy ?? null,
      locationCapturedAt: new Date().toISOString(),
    };
  } catch {
    return base;
  }
}

export default function Issues() {
  const router = useRouter();
  const { driver, session } = useFleet(),
    action = useAction(),
    token = session?.sessionToken;
  const [items, setItems] = useState<DriverIssue[]>([]),
    [error, setError] = useState(""),
    [sent, setSent] = useState<ReportResult | null>(null),
    [submission, setSubmission] = useState<Submission | null>(null);
  const truck = driver?.truck ?? driver?.schedule?.truck ?? null;
  const load = useCallback(async () => {
    try {
      const result = await request<{ items: DriverIssue[] }>("driver/issues", {
        session: token,
      });
      setItems(result.items);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load your reports.",
      );
    }
  }, [token]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    const poll = setInterval(() => void load(), 20_000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [load]);
  async function send(
    category: IssueCategory,
    serviceType: ServiceType,
    description: string,
    locationText: string,
  ) {
    // Keep the exact request after a timeout so retrying cannot create a second issue.
    const body =
      submission ??
      ({
        id: Crypto.randomUUID(),
        truckId: truck?.id ?? null,
        category,
        ...(category === "vehicle" ? { serviceType } : {}),
        description: description.trim(),
        ...(await shareLocation(locationText)),
      } satisfies Submission);
    setSubmission(body);
    try {
      const result = await request<ReportResult>("driver/issues", {
        method: "POST",
        session: token,
        body,
      });
      setSubmission(null);
      setSent(result);
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500
      )
        setSubmission(null);
      throw cause;
    }
    await load();
  }
  const form = useForm({
    defaultValues: {
      category: "vehicle" as IssueCategory,
      serviceType: "mechanical" as ServiceType,
      description: "",
      locationText: "",
    },
    onSubmit: ({ value, formApi }) =>
      action.run(async () => {
        if (!value.description.trim()) return;
        await send(
          value.category,
          value.serviceType,
          value.description,
          value.locationText,
        );
        formApi.reset();
      }),
  });
  const category = useStore(form.store, (state) => state.values.category);
  const serviceType = useStore(form.store, (state) => state.values.serviceType);
  const hasDescription = useStore(
    form.store,
    (state) => !!state.values.description.trim(),
  );
  const canReport = hasDescription && (category !== "vehicle" || !!truck);
  const sentJob = sent?.job
    ? (items.find((item) => item.job?.id === sent.job?.id)?.job ?? sent.job)
    : null;
  const resetReport = () => {
    setSent(null);
    setSubmission(null);
    form.reset();
  };
  return (
    <Screen
      actions={
        <>
          {!sent && (
            <Button
              loading={action.busy}
              disabled={!canReport}
              onPress={() => void form.handleSubmit()}
            >
              {submission
                ? "Retry report"
                : category === "vehicle"
                  ? "Get help"
                  : "Send report"}
            </Button>
          )}
          {sent && (
            <Button onPress={resetReport}>Report another issue</Button>
          )}
          <Button
            secondary
            disabled={action.busy}
            onPress={() => router.back()}
          >
            Back
          </Button>
        </>
      }
    >
      <Heading title={sent ? "Help requested" : "Get help"} />
      {sent ? (
        <>
          <Copy>
            {sent.duplicate
              ? "A service request is already open for this vehicle. Check your reports for the latest status."
              : sent.alerts === "queued"
                ? "Service providers are being alerted. We will update this page when one accepts."
                : sent.job
                  ? "Your report was received. The office will follow up."
                  : "Your report was sent to your administrator for review."}
          </Copy>
          {sentJob && (
            <View style={styles.card}>
              <Copy small>Job {sentJob.reference}</Copy>
              <Copy>{jobStatusLabel(sentJob)}</Copy>
              {sentJob.provider && (
                <Copy small>{sentJob.provider.companyName}</Copy>
              )}
            </View>
          )}
        </>
      ) : (
        <>
          {truck && <TruckCard truck={truck} meta={driver?.truck ? "Driving now" : "Scheduled"} />}
          <Copy>Issue type</Copy>
          <View style={styles.group}>
            {(Object.keys(issueLabels) as IssueCategory[]).map((value) => (
              <Button
                key={value}
                secondary={category !== value}
                selected={category === value}
                disabled={action.busy || !!submission}
                onPress={() => form.setFieldValue("category", value)}
              >
                {issueLabels[value]}
              </Button>
            ))}
          </View>
          {category === "vehicle" && !truck && (
            <Notice
              title="Vehicle not confirmed"
              message="Confirm the vehicle you are driving before requesting breakdown help."
            />
          )}
          {category === "vehicle" && (
            <>
              <Copy>What kind of help?</Copy>
              <View style={styles.group}>
                {serviceTypes.map((value) => (
                  <Button
                    key={value}
                    secondary={serviceType !== value}
                    selected={serviceType === value}
                    disabled={action.busy || !!submission}
                    onPress={() => form.setFieldValue("serviceType", value)}
                  >
                    {serviceTypeLabels[value]}
                  </Button>
                ))}
              </View>
              <Copy small>
                We will alert service providers if they are available.
              </Copy>
            </>
          )}
          <form.Field name="description">
            {(field) => (
              <Field
                label="What happened?"
                value={field.state.value}
                onChangeText={field.handleChange}
                onBlur={field.handleBlur}
                multiline
                maxLength={2000}
                editable={!action.busy && !submission}
              />
            )}
          </form.Field>
          <form.Field name="locationText">
            {(field) => (
              <Field
                label="Where are you? (optional)"
                value={field.state.value}
                onChangeText={field.handleChange}
                onBlur={field.handleBlur}
                maxLength={300}
                editable={!action.busy && !submission}
              />
            )}
          </form.Field>
          <Copy small>
            Add a road name or landmark. Your phone location is shared if
            available.
          </Copy>
        </>
      )}
      <Notice message={action.error || error} />
      {items.length > 0 && (
        <>
          <Heading title="Your reports" />
          <Button
            secondary
            loading={action.busy}
            onPress={() => void action.run(load)}
          >
            Check for updates
          </Button>
          {items.map((item) => (
            <View key={item.id} style={styles.card}>
              <Copy>
                {issueLabels[item.category]}
                {item.truck ? ` · ${item.truck.registration}` : ""}
              </Copy>
              <Copy>{item.description}</Copy>
              {item.job ? (
                <>
                  <Copy small>
                    Job {item.job.reference} · {jobStatusLabel(item.job)}
                  </Copy>
                  {item.job.provider && (
                    <Copy small>{item.job.provider.companyName}</Copy>
                  )}
                </>
              ) : (
                <Copy small>
                  {item.resolvedAt ? "Resolved" : "Waiting for review"}
                </Copy>
              )}
              <Copy small>{new Date(item.createdAt).toLocaleString()}</Copy>
              {item.resolutionNote && <Copy>{item.resolutionNote}</Copy>}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
