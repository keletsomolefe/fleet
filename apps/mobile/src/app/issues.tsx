import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
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
  issueLabels,
} from "@/lib/issues";
import { useFleet } from "@/state/fleet";

export default function Issues() {
  const { driver, session } = useFleet(),
    action = useAction(),
    token = session?.sessionToken;
  const [category, setCategory] = useState<IssueCategory>("vehicle"),
    [description, setDescription] = useState(""),
    [items, setItems] = useState<DriverIssue[]>([]),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false),
    [submission, setSubmission] = useState<{
      id: string;
      truckId: string | null;
      category: IssueCategory;
      description: string;
    } | null>(null);
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
    return () => clearTimeout(timer);
  }, [load]);
  async function send() {
    // Keep the exact request after a timeout so retrying cannot create a second issue.
    const body = submission ?? {
      id: Crypto.randomUUID(),
      truckId: truck?.id ?? null,
      category,
      description: description.trim(),
    };
    setSubmission(body);
    try {
      await request("driver/issues", {
        method: "POST",
        session: session?.sessionToken,
        body,
      });
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500
      )
        setSubmission(null);
      throw cause;
    }
    setSent(true);
    setSubmission(null);
    setDescription("");
    await load();
  }
  return (
    <Screen
      actions={
        <>
          {!sent && (
            <Button
              loading={action.busy}
              disabled={!description.trim()}
              onPress={() => void action.run(send)}
            >
              {submission ? "Retry report" : "Send report"}
            </Button>
          )}
          {sent && (
            <Button
              onPress={() => {
                setSent(false);
                setSubmission(null);
              }}
            >
              Report another issue
            </Button>
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
      <Heading title={sent ? "Issue reported" : "Report an issue"} />
      {sent ? (
        <Copy>Your administrator will review your report.</Copy>
      ) : (
        <>
          {truck && <TruckCard truck={truck} />}
          <Copy>Issue type</Copy>
          <View style={styles.group}>
            {(Object.keys(issueLabels) as IssueCategory[]).map((value) => (
              <Button
                key={value}
                secondary={category !== value}
                disabled={action.busy || !!submission}
                onPress={() => setCategory(value)}
              >
                {issueLabels[value]}
              </Button>
            ))}
          </View>
          <Field
            label="What happened?"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={2000}
            editable={!action.busy && !submission}
          />
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
              <Copy small>
                {item.resolvedAt ? "Resolved" : "Waiting for review"} ·{" "}
                {new Date(item.createdAt).toLocaleString()}
              </Copy>
              {item.resolutionNote && <Copy>{item.resolutionNote}</Copy>}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
