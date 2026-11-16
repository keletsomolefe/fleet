import { useEffect, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { submitForm, textFieldProps } from "@/lib/form";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { AuthLayout } from "@/components/auth-layout";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { logout } from "@/lib/auth";
import {
  loadAuthFlow,
  submitAuthFlow,
  type FlowKind,
  type FlowPageData,
} from "@/lib/auth-flow";

export function KratosForm({
  kind,
  initial,
  reason,
}: {
  kind: FlowKind;
  initial: FlowPageData;
  reason?: string;
}) {
  const navigate = useNavigate();
  const [flow, setFlow] = useState(initial.flow);
  const [error, setError] = useState(initial.error ?? "");
  const [initializing, setInitializing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [complete, setComplete] = useState(
    initial.flow?.state === "passed_challenge",
  );
  const [alreadyAuthenticated, setAlreadyAuthenticated] = useState(
    initial.alreadyAuthenticated,
  );
  const [loaded, setLoaded] = useState(initial);
  if (loaded !== initial) {
    setLoaded(initial);
    // An action can update the flow before navigation loads that same ID.
    if (!flow || flow.id !== initial.flow?.id) {
      setFlow(initial.flow);
      setError(initial.error ?? "");
      setComplete(initial.flow?.state === "passed_challenge");
      setAlreadyAuthenticated(initial.alreadyAuthenticated);
      setShowPassword(false);
    }
  }
  const denied = reason === "access-denied";
  const unavailable = reason === "unavailable";
  const verification = kind === "verification";
  const csrfToken =
    flow?.ui.nodes.find((n) => n.attributes.name === "csrf_token")?.attributes
      .value ?? "";

  function syncFlowUrl(id: string) {
    if (id === initial.flow?.id) return;
    return navigate({
      to: verification ? "/verify-email" : "/login",
      search: { flow: id, reason },
      replace: true,
      resetScroll: false,
    });
  }

  async function initialize() {
    setInitializing(true);
    setError("");
    try {
      const result = await loadAuthFlow({ data: { kind, flowId: flow?.id } });
      setFlow(result.flow);
      setError(result.error ?? "");
      setAlreadyAuthenticated(result.alreadyAuthenticated);
      if (result.flow) await syncFlowUrl(result.flow.id);
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setInitializing(false);
    }
  }

  const form = useForm({
    defaultValues: { identifier: "", password: "", email: "", code: "" },
    onSubmit: async ({ value, formApi }) => {
      if (!flow || initializing) return;
      const values: Record<string, string> = verification
        ? { email: value.email, ...(needsCode ? { code: value.code } : {}) }
        : { identifier: value.identifier, password: value.password };
      setError("");
      try {
        const result = await submitAuthFlow({
          data: { kind, flowId: flow.id, csrfToken, values },
        });
        if (result.redirect) {
          window.location.assign(result.redirect);
          return;
        }
        if (result.flow) setFlow(result.flow);
        if (result.complete) formApi.reset();
        if (result.complete) setComplete(true);
        if (result.error) setError(result.error);
        if (result.flow) await syncFlowUrl(result.flow.id);
      } catch {
        setError("Could not connect. Please try again.");
      }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const busy = initializing || isSubmitting;
  useEffect(() => {
    form.reset();
  }, [form, kind, flow?.id]);

  const messages = [
    ...(flow?.ui.messages ?? []),
    ...(flow?.ui.nodes.flatMap((n) => n.messages ?? []) ?? []),
  ];
  const needsCode =
    flow?.state === "sent_email" ||
    flow?.ui.nodes.some((n) => n.attributes.name === "code");

  return (
    <AuthLayout>
      <Card className="gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <h1>{verification ? "Verify your email" : "Welcome to VHH Fleet"}</h1>
          {denied && (
            <Alert variant="destructive">
              <AlertDescription>
                You don’t have access to this page. Contact your administrator
                or sign out to use another account.
              </AlertDescription>
            </Alert>
          )}
          {unavailable && (
            <Alert>
              <AlertDescription>
                Could not sign you in. Please try again.
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {messages.map((message, index) => (
            <Alert
              key={`${message.id}-${index}`}
              variant={message.type === "error" ? "destructive" : "default"}
            >
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          ))}
          {complete ? (
            <div className="space-y-6">
              <Alert>
                <AlertDescription>Email verified.</AlertDescription>
              </Alert>
              <Button asChild className="w-full">
                <a href="/login">Sign in</a>
              </Button>
            </div>
          ) : denied ? null : alreadyAuthenticated ? (
            <Button asChild className="w-full">
              <a href="/admin">Open VHH Fleet</a>
            </Button>
          ) : flow ? (
            <form
              key={flow.id}
              onSubmit={submitForm(form)}
              className="space-y-6"
            >
              <input
                type="hidden"
                name="csrf_token"
                value={csrfToken}
                readOnly
              />
              {verification ? (
                <>
                  <form.Field name="email">
                    {(field) => (
                      <FormField
                        {...textFieldProps(field)}
                        label="Email address"
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        required={!needsCode}
                      />
                    )}
                  </form.Field>
                  {needsCode && (
                    <form.Field name="code">
                      {(field) => (
                        <FormField
                          {...textFieldProps(field)}
                          label="Verification code"
                          id="code"
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          placeholder="Enter your code"
                          required
                        />
                      )}
                    </form.Field>
                  )}
                </>
              ) : (
                <>
                  <form.Field name="identifier">
                    {(field) => (
                      <FormField
                        {...textFieldProps(field)}
                        label="Email address"
                        id="identifier"
                        type="email"
                        autoComplete="username"
                        placeholder="you@example.com"
                        required
                      />
                    )}
                  </form.Field>
                  <div className="relative">
                    <form.Field name="password">
                      {(field) => (
                        <FormField
                          {...textFieldProps(field)}
                          label="Password"
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          required
                        />
                      )}
                    </form.Field>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 bottom-1 size-10"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <div className="text-right">
                    {initial.recoveryUrl ? (
                      <a
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                        href={initial.recoveryUrl}
                      >
                        Forgot password?
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Forgot password? Contact your administrator.
                      </p>
                    )}
                  </div>
                </>
              )}
              <Button className="w-full" disabled={busy}>
                {busy && <LoaderCircle className="animate-spin" />}
                {verification
                  ? needsCode
                    ? "Verify email"
                    : "Send code"
                  : "Sign in"}
              </Button>
              {verification && needsCode && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void initialize()}
                >
                  Send a new code
                </Button>
              )}
            </form>
          ) : (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => void initialize()}
            >
              {busy && <LoaderCircle className="animate-spin" />}Try again
            </Button>
          )}
          {!verification && (
            <Button asChild variant="outline" className="w-full">
              <a href="/downloads/android/latest.apk">Download Android app</a>
            </Button>
          )}
          {verification && (
            <Button asChild variant="ghost" className="w-full">
              <a href="/login">Back to sign in</a>
            </Button>
          )}
          {(denied || alreadyAuthenticated) && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() =>
                void logout().catch((cause) => setError(cause.message))
              }
            >
              Sign out
            </Button>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
