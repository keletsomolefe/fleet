import { PageHeader } from "@/components/page-header";
import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { PageError } from "@/components/page-error";
import { can, type AdminSession } from "@/lib/auth";
import {
  getUser,
  getRoles,
  updateAccess,
  type CompanyUser,
  type RoleDefinition,
} from "@/lib/users";

export const Route = createFileRoute("/admin/users/$userId")({
  loader: async ({ params }) => {
    const [user, roles] = await Promise.all([
      getUser({ data: params.userId }),
      getRoles(),
    ]);
    return { user, roles };
  },
  staleTime: 0,
  gcTime: 0,
  component: UserDetail,
});

function UserDetail() {
  const { user, roles } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  if (!user.data || !roles.data)
    return <PageError message={user.error ?? roles.error!} />;
  return (
    <AccessForm
      key={user.data.id}
      user={user.data}
      roles={roles.data}
      session={session}
    />
  );
}

function AccessForm({
  user,
  roles,
  session,
}: {
  user: CompanyUser;
  roles: RoleDefinition[];
  session: AdminSession;
}) {
  const router = useRouter();
  const [roleIds, setRoleIds] = useState(user.roles.map((role) => role.id));
  const [active, setActive] = useState(user.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const owner = user.roles.some((role) => role.key === "owner");
  const editable =
    can(session, "users.access") && (!owner || can(session, "users.owners"));
  const [accountLink, setAccountLink] = useState<{
      url: string;
      expiresAt: string;
    } | null>(null),
    [linkBusy, setLinkBusy] = useState(false),
    [linkError, setLinkError] = useState(""),
    [copied, setCopied] = useState(false);
  async function createLink() {
    setLinkBusy(true);
    setLinkError("");
    setAccountLink(null);
    setCopied(false);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/account-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: "{}",
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.message ?? "Could not create setup link.");
      setAccountLink(data);
    } catch (e) {
      setLinkError(
        e instanceof Error ? e.message : "Could not create setup link.",
      );
    } finally {
      setLinkBusy(false);
    }
  }
  const selectedPermissions = [
    ...new Map(
      roles
        .filter((role) => roleIds.includes(role.id))
        .flatMap((role) => role.permissions)
        .map((permission) => [permission.key, permission]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await updateAccess(user.id, roleIds, active, session.csrfToken);
      await router.invalidate();
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save access.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title={`${user.firstName} ${user.lastName}`}
        group="Company"
        actions={
          <Link
            to="/admin/users"
            search={{ q: "", page: 1 }}
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Users
          </Link>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(240px,320px)_minmax(0,640px)]">
        <Card className="shadow-none">
          <CardContent className="space-y-5">
            <Avatar className="size-14">
              <AvatarFallback>
                {user.firstName[0]}
                {user.lastName[0]}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">
                {user.firstName} {user.lastName}
              </h2>
              <p className="text-xs break-all text-muted-foreground">
                {user.email}
              </p>
            </div>
            <Badge variant="outline">
              {user.isActive ? "Active" : "Inactive"}
            </Badge>
            <dl className="space-y-4 border-t pt-5 text-xs">
              <div className="space-y-1">
                <dt className="text-muted-foreground">Last sign in</dt>
                <dd>
                  {user.lastLoginAt
                    ? new Intl.DateTimeFormat("en-ZA", {
                        dateStyle: "medium",
                        timeZone: "Africa/Johannesburg",
                      }).format(new Date(user.lastLoginAt))
                    : "Never"}
                </dd>
              </div>
            </dl>
            {editable && user.isActive && (
              <div className="space-y-3 border-t pt-4">
                <h2 className="text-sm font-semibold">Account setup</h2>
                <Button
                  variant="outline"
                  disabled={linkBusy}
                  onClick={() => void createLink()}
                >
                  {linkBusy ? "Creating…" : "Generate setup link"}
                </Button>
                {accountLink && (
                  <>
                    <Label htmlFor="account-link">Setup link</Label>
                    <Input
                      id="account-link"
                      readOnly
                      value={accountLink.url}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <p className="text-xs text-muted-foreground">
                      Valid for 30 minutes. Use once.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(accountLink.url)
                          .then(() => {
                            setCopied(true);
                            setLinkError("");
                          })
                          .catch(() =>
                            setLinkError("Select and copy the link above."),
                          );
                      }}
                    >
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </>
                )}
                {linkError && (
                  <p role="alert" className="text-xs text-destructive">
                    {linkError}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent>
            <form onSubmit={submit} className="space-y-6 text-left">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-base font-semibold">Access</h2>
                <div className="flex items-center gap-3">
                  <Label htmlFor="active">Active</Label>
                  <Switch
                    id="active"
                    checked={active}
                    disabled={!editable || user.id === session.user.id || busy}
                    onCheckedChange={(value) => {
                      setActive(value);
                      setSaved(false);
                    }}
                  />
                </div>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {saved && (
                <p role="status" className="text-xs">
                  Access updated
                </p>
              )}
              <fieldset className="space-y-3" disabled={!editable || busy}>
                <legend className="mb-3 text-xs font-semibold">Roles</legend>
                {roles.map((role) => (
                  <div
                    key={role.id}
                    className="flex items-center gap-3 rounded-lg border p-4"
                  >
                    <Checkbox
                      id={`role-${role.id}`}
                      checked={roleIds.includes(role.id)}
                      disabled={
                        role.key === "owner" && !can(session, "users.owners")
                      }
                      onCheckedChange={(checked) => {
                        setRoleIds((ids) =>
                          checked === true
                            ? [...ids, role.id]
                            : ids.filter((id) => id !== role.id),
                        );
                        setSaved(false);
                      }}
                    />
                    <Label
                      htmlFor={`role-${role.id}`}
                      className="flex-1 text-xs"
                    >
                      {role.name}
                    </Label>
                    <span className="text-[11px] text-muted-foreground">
                      {role.permissions.length}{" "}
                      {role.permissions.length === 1
                        ? "permission"
                        : "permissions"}
                    </span>
                  </div>
                ))}
              </fieldset>
              <details className="border-t pt-4">
                <summary className="cursor-pointer text-xs font-semibold">
                  Permissions ({selectedPermissions.length})
                </summary>
                <ul className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  {selectedPermissions.map((permission) => (
                    <li key={permission.key}>{permission.name}</li>
                  ))}
                  {!selectedPermissions.length && <li>No access assigned</li>}
                </ul>
              </details>
              {editable && (
                <Button type="submit" disabled={busy} className="justify-start">
                  {busy && <LoaderCircle className="animate-spin" />}Save access
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
