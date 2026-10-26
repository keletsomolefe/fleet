import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, LoaderCircle } from "lucide-react";
import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageError } from "@/components/page-error";
import { can } from "@/lib/auth";
import { deniedPage } from "@/lib/users";

export const Route = createFileRoute("/admin/users/new")({
  loader: ({ context }) =>
    can(context.session, "users.create") ? { denied: false } : deniedPage(),
  staleTime: 0,
  gcTime: 0,
  component: CreateUser,
});

function CreateUser() {
  const { session } = Route.useRouteContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    email: string;
    id: string;
    requiresEmailVerification: boolean;
  } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    if (data.get("password") !== data.get("confirmation")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({
          firstName: data.get("firstName"),
          lastName: data.get("lastName"),
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : "Could not create the user.",
        );
      setCreated({
        email: body.user.email,
        id: body.user.id,
        requiresEmailVerification: body.requiresEmailVerification,
      });
      form.reset();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!can(session, "users.create"))
    return <PageError message="You do not have access to this page." />;
  return (
    <>
      <div className="space-y-1 py-2">
        <p className="text-[11px] text-muted-foreground uppercase">Company</p>
        <h1>Create user</h1>
      </div>
      <Card className="w-full max-w-[640px] self-start rounded-xl py-0 text-left shadow-none">
        <CardContent className="space-y-6 p-6 sm:p-8">
          {created ? (
            <div className="space-y-6">
              <div className="flex size-12 items-center justify-center rounded-full border">
                <Check aria-hidden="true" />
              </div>
              <h2 className="text-base font-semibold">User created</h2>
              <p className="text-xs leading-5 text-muted-foreground">
                {created.email}
              </p>
              {created.requiresEmailVerification && (
                <p className="text-xs text-muted-foreground">
                  Email verification pending
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  className="justify-start text-left"
                  onClick={() => setCreated(null)}
                >
                  Create another user
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="justify-start text-left"
                >
                  <Link
                    to="/admin/users/$userId"
                    params={{ userId: created.id }}
                  >
                    Manage access
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={submit} className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <FormField
                    id="firstName"
                    name="firstName"
                    label="First name"
                    autoComplete="given-name"
                    maxLength={100}
                    required
                  />
                  <FormField
                    id="lastName"
                    name="lastName"
                    label="Last name"
                    autoComplete="family-name"
                    maxLength={100}
                    required
                  />
                </div>
                <FormField
                  id="email"
                  name="email"
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  maxLength={320}
                  required
                />
                <FormField
                  id="password"
                  name="password"
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  hint="At least 8 characters"
                  required
                />
                <FormField
                  id="confirmation"
                  name="confirmation"
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    disabled={busy}
                    className="justify-start text-left"
                  >
                    {busy && <LoaderCircle className="animate-spin" />}Create
                    user
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="justify-start text-left"
                  >
                    <Link to="/admin/users" search={{ q: "", page: 1 }}>
                      Cancel
                    </Link>
                  </Button>
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
