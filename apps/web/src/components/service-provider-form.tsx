import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { BackLink, PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayDate } from "@/lib/fleet";
import { submitForm, textFieldProps } from "@/lib/form";
import type { AdminSession } from "@/lib/auth";
import {
  createProvider,
  providerServiceOptions,
  serviceTypeLabels,
  type ServiceProvider,
  type ServiceType,
  updateProvider,
} from "@/lib/service-jobs";

export function ServiceProviderForm({
  session,
  provider,
}: {
  session: AdminSession;
  provider?: ServiceProvider;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const needsConsent = (number: string, enabled: boolean) => {
    if (!provider) return enabled;
    return number.replace(/[\s().-]/g, "") !== provider.whatsappNumber ||
      (enabled && (!provider.alertsEnabled || !provider.optedInAt || !!provider.optedOutAt));
  };
  const form = useForm({
    defaultValues: {
      companyName: provider?.companyName ?? "",
      contactName: provider?.contactName ?? "",
      whatsappNumber: provider?.whatsappNumber ?? "",
      phone: provider?.phone ?? "",
      email: provider?.email ?? "",
      services: provider?.services ?? ([] as ServiceType[]),
      coverageArea: provider?.coverageArea ?? "",
      notes: provider?.notes ?? "",
      status: provider?.status ?? "active",
      alertsEnabled: provider?.alertsEnabled ?? true,
      consent: false,
    },
    validators: {
      onSubmit: ({ value }) => {
        if (!value.companyName.trim()) return "Enter the company name.";
        if (!value.contactName.trim()) return "Enter the contact person.";
        if (!/^\+[1-9]\d{7,14}$/.test(value.whatsappNumber.replace(/[\s().-]/g, "")))
          return "Enter the WhatsApp number with country code, for example +27821234567.";
        if (!value.services.length) return "Choose at least one service.";
        if (needsConsent(value.whatsappNumber, value.alertsEnabled) && !value.consent)
          return "Confirm that the provider agreed to receive WhatsApp alerts.";
      },
    },
    onSubmit: async ({ value }) => {
      setError("");
      setSaved("");
      try {
        const body = {
          companyName: value.companyName.trim(),
          contactName: value.contactName.trim(),
          whatsappNumber: value.whatsappNumber.trim(),
          phone: value.phone.trim() || null,
          email: value.email.trim() || null,
          services: value.services,
          coverageArea: value.coverageArea.trim() || null,
          notes: value.notes.trim() || null,
          status: value.status,
          alertsEnabled: value.alertsEnabled,
          consent: value.consent,
        };
        const result = provider
          ? await updateProvider(session.csrfToken, provider.id, body)
          : await createProvider(session.csrfToken, body);
        if (!provider) {
          await navigate({
            to: "/admin/providers/$providerId",
            params: { providerId: result.id },
          });
          return;
        }
        setSaved("Service provider saved.");
        form.setFieldValue("consent", false);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save the service provider.",
        );
      }
    },
  });
  const busy = useStore(form.store, (state) => state.isSubmitting);
  const validationError = useStore(
    form.store,
    (state) => state.errorMap.onSubmit,
  );
  const alertsEnabled = useStore(
    form.store,
    (state) => state.values.alertsEnabled,
  );
  const whatsappNumber = useStore(
    form.store,
    (state) => state.values.whatsappNumber,
  );
  const selectedServices = useStore(
    form.store,
    (state) => state.values.services,
  );
  const consent = useStore(form.store, (state) => state.values.consent);
  const optedOut = !!provider?.optedOutAt;
  const consentRequired = needsConsent(whatsappNumber, alertsEnabled);
  return (
    <>
      <PageHeader
        back={<BackLink to="/admin/providers">Service providers</BackLink>}
        title={provider ? provider.companyName : "Add service provider"}
        group="Operations"
        description={
          provider
            ? `${provider.contactName} · ${provider.whatsappNumber}`
            : "Record the company and WhatsApp details used for job alerts."
        }
      />
      {(validationError || error) && (
        <Alert variant="destructive">
          <AlertDescription>{validationError || error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert role="status">
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      {optedOut && (
        <Alert>
          <AlertDescription>
            This provider opted out of WhatsApp alerts
            {provider?.optedOutAt
              ? ` on ${displayDate(provider.optedOutAt)}`
              : ""}
            {provider?.optOutReason ? ` (${provider.optOutReason})` : ""}. Confirm
            new consent before enabling alerts again.
          </AlertDescription>
        </Alert>
      )}
      <form onSubmit={submitForm(form)} className="max-w-3xl space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          <Card className="gap-5 p-4 shadow-none sm:p-6">
            <h2 className="text-sm font-semibold">Company details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="companyName">Company name</Label>
                <form.Field name="companyName">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      id="companyName"
                      required
                      maxLength={120}
                    />
                  )}
                </form.Field>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactName">Contact person</Label>
                <form.Field name="contactName">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      id="contactName"
                      required
                      maxLength={80}
                    />
                  )}
                </form.Field>
              </div>
              <div className="space-y-2">
                <Label htmlFor="whatsappNumber">WhatsApp number</Label>
                <form.Field name="whatsappNumber">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      id="whatsappNumber"
                      type="tel"
                      required
                      maxLength={20}
                      placeholder="+27821234567"
                    />
                  )}
                </form.Field>
                <p className="text-[11px] text-muted-foreground">
                  Include the country code.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Other phone (optional)</Label>
                <form.Field name="phone">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      id="phone"
                      type="tel"
                      maxLength={30}
                    />
                  )}
                </form.Field>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Email (optional)</Label>
                <form.Field name="email">
                  {(field) => (
                    <Input
                      {...textFieldProps(field)}
                      id="email"
                      type="email"
                      maxLength={320}
                    />
                  )}
                </form.Field>
              </div>
            </div>
          </Card>
          <Card className="gap-5 p-4 shadow-none sm:p-6">
            <h2 className="text-sm font-semibold">Services and coverage</h2>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Services</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {providerServiceOptions.map((service) => (
                  <label
                    key={service}
                    className="flex items-center gap-3 rounded-md border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selectedServices.includes(service)}
                      onChange={(event) => {
                        const current = selectedServices;
                        form.setFieldValue(
                          "services",
                          event.currentTarget.checked
                            ? [...current, service]
                            : current.filter((item) => item !== service),
                        );
                      }}
                    />
                    {serviceTypeLabels[service]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="coverageArea">Coverage area (optional)</Label>
              <form.Field name="coverageArea">
                {(field) => (
                  <Input
                    {...textFieldProps(field)}
                    id="coverageArea"
                    maxLength={120}
                    placeholder="Polokwane and surrounds"
                  />
                )}
              </form.Field>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <form.Field name="notes">
                {(field) => (
                  <textarea
                    {...textFieldProps(field)}
                    id="notes"
                    maxLength={1000}
                    className="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                  />
                )}
              </form.Field>
            </div>
          </Card>
          <Card className="gap-4 p-4 shadow-none sm:p-6">
            <h2 className="text-sm font-semibold">Alerts</h2>
            <div className="space-y-2">
              <Label htmlFor="status">Availability</Label>
              <form.Field name="status">
                {(field) => (
                  <select
                    id="status"
                    value={field.state.value}
                    onChange={(event) =>
                      field.handleChange(
                        event.currentTarget.value as "active" | "paused",
                      )
                    }
                    className="h-12 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                )}
              </form.Field>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={alertsEnabled}
                onChange={(event) =>
                  form.setFieldValue(
                    "alertsEnabled",
                    event.currentTarget.checked,
                  )
                }
              />
              <span>
                <span className="font-semibold">
                  Receive job alerts on WhatsApp
                </span>
                <span className="block text-xs text-muted-foreground">
                  Paused or opted-out providers are not alerted.
                </span>
              </span>
            </label>
            {consentRequired && (
              <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={consent}
                  onChange={(event) =>
                    form.setFieldValue("consent", event.currentTarget.checked)
                  }
                />
                <span>
                  This provider agreed to receive VHH Fleet job alerts on
                  WhatsApp.
                </span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : provider ? "Save provider" : "Add provider"}
              </Button>
              <Button variant="outline" asChild>
                <Link to="/admin/providers" search={{ q: "", page: 1, status: "" }}>
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
