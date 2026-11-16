import { useEffect, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BackLink, PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminSession } from "@/lib/auth";
import type { Truck } from "@/lib/fleet";
import { submitForm, textFieldProps } from "@/lib/form";
import {
  createJob,
  getProviders,
  providerSearchDefaults,
  serviceTypeDescriptions,
  serviceTypeLabels,
  type ServiceType,
} from "@/lib/service-jobs";

const choices = Object.keys(serviceTypeLabels) as ServiceType[];

export function ServiceJobForm({ session }: { session: AdminSession }) {
  const router = useNavigate();
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);
  const trucks = useQuery({
    queryKey: ["job-truck-options", search],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/admin/trucks?${new URLSearchParams({
          q: search,
          page: "1",
          status: "active",
        })}`,
        { cache: "no-store", signal },
      );
      if (!response.ok) throw new Error("Could not load vehicles.");
      return (await response.json()) as { items: Truck[] };
    },
  });
  const providers = useQuery({
    queryKey: ["job-provider-count"],
    queryFn: () => getProviders({ ...providerSearchDefaults, status: "active" }),
  });
  const eligibleProviders =
    providers.data?.items.filter(
      (provider) =>
        provider.status === "active" &&
        provider.alertsEnabled &&
        !provider.optedOutAt,
    ).length ?? 0;
  const form = useForm({
    defaultValues: {
      truckId: "",
      serviceType: "mechanical" as ServiceType,
      urgency: "urgent" as "urgent" | "normal",
      title: "",
      description: "",
      locationText: "",
      notifyProviders: true,
    },
    validators: {
      onSubmit: ({ value }) => {
        if (!value.truckId) return "Choose a vehicle.";
        if (!value.description.trim()) return "Describe the issue.";
      },
    },
    onSubmit: async ({ value }) => {
      setError("");
      try {
        const created = await createJob(session.csrfToken, {
          truckId: value.truckId,
          serviceType: value.serviceType,
          urgency: value.urgency,
          title: value.title.trim() || null,
          description: value.description.trim(),
          locationText: value.locationText.trim() || null,
          notifyProviders: value.notifyProviders,
        });
        await router({ to: "/admin/jobs/$jobId", params: { jobId: created.id } });
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not create the job.",
        );
      }
    },
  });
  useEffect(() => {
    if (!selectedTruck) return;
    form.setFieldValue("truckId", selectedTruck.id);
  }, [form, selectedTruck]);
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  const serviceType = useStore(
    form.store,
    (state) => state.values.serviceType,
  );
  const notify = useStore(form.store, (state) => state.values.notifyProviders);
  return (
    <>
      <PageHeader
        back={<BackLink to="/admin/jobs">Service jobs</BackLink>}
        title="New service job"
        group="Operations"
        description="Alert service providers for a breakdown or assistance request."
      />
      {(validationError || error) && (
        <Alert variant="destructive">
          <AlertDescription>{validationError || error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submitForm(form)} className="max-w-3xl space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <Card className="gap-5 p-4 shadow-none sm:p-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Vehicle</h2>
              <Input
                aria-label="Search vehicles"
                placeholder="Search registration or fleet number"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                maxLength={200}
              />
              {selectedTruck ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {selectedTruck.registration}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedTruck.identifier} · {selectedTruck.make}{" "}
                      {selectedTruck.model}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedTruck(null);
                      form.setFieldValue("truckId", "");
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="max-h-56 overflow-auto rounded-lg border">
                  {trucks.isPending ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      Loading vehicles…
                    </p>
                  ) : trucks.error ? (
                    <p className="p-3 text-sm text-destructive">
                      {trucks.error.message}
                    </p>
                  ) : !trucks.data?.items.length ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No matching active vehicles.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {trucks.data.items.map((truck) => (
                        <li key={truck.id}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                            onClick={() => setSelectedTruck(truck)}
                          >
                            <span>
                              <span className="font-semibold">
                                {truck.registration}
                              </span>{" "}
                              <span className="text-muted-foreground">
                                {truck.identifier}
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {truck.make} {truck.model}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Card>
          <Card className="gap-5 p-4 shadow-none sm:p-6">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Issue</h2>
              <div className="space-y-2">
                <Label htmlFor="serviceType">Service needed</Label>
                <form.Field name="serviceType">
                  {(field) => (
                    <select
                      id="serviceType"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.currentTarget.value as ServiceType)
                      }
                      className="h-12 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {serviceTypeLabels[choice]}
                        </option>
                      ))}
                    </select>
                  )}
                </form.Field>
                <p className="text-xs text-muted-foreground">
                  {serviceTypeDescriptions[serviceType]}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="urgency">Priority</Label>
                <form.Field name="urgency">
                  {(field) => (
                    <select
                      id="urgency"
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(
                          event.currentTarget.value as "urgent" | "normal",
                        )
                      }
                      className="h-12 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <option value="urgent">Urgent</option>
                      <option value="normal">Normal</option>
                    </select>
                  )}
                </form.Field>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Short title (optional)</Label>
                <form.Field name="title">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      id="title"
                      maxLength={120}
                      placeholder="Engine overheating"
                    />
                  )}
                </form.Field>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">What happened?</Label>
                <form.Field name="description">
                  {(field) => (
                    <textarea
                      {...textFieldProps(field)}
                      id="description"
                      required
                      maxLength={2000}
                      className="min-h-32 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    />
                  )}
                </form.Field>
              </div>
              <div className="space-y-2">
                <Label htmlFor="locationText">Location (optional)</Label>
                <form.Field name="locationText">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      id="locationText"
                      maxLength={300}
                      placeholder="N1 North, near Polokwane"
                    />
                  )}
                </form.Field>
              </div>
            </div>
          </Card>
          <Card className="gap-4 p-4 shadow-none sm:p-6">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) =>
                  form.setFieldValue("notifyProviders", event.currentTarget.checked)
                }
                className="mt-1 size-4"
              />
              <span>
                <span className="font-semibold">Alert service providers</span>
                <span className="block text-xs text-muted-foreground">
                  {eligibleProviders
                    ? `${eligibleProviders} eligible provider${eligibleProviders === 1 ? "" : "s"} will be alerted.`
                    : "No eligible service providers are configured."}
                </span>
              </span>
            </label>
            {providers.error && (
              <p role="alert" className="text-xs text-destructive">
                {providers.error.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create job"}
              </Button>
              <Button variant="outline" asChild>
                <Link to="/admin/jobs" search={{ q: "", page: 1, status: "active", providerId: "" }}>
                  Cancel
                </Link>
              </Button>
            </div>
          </Card>
        </fieldset>
      </form>
    </>
  );
}
