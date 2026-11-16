import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Wrench } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RepairForm } from "@/components/repair-form";

type Issue = {
  id: string;
  truck: { registration: string; identifier: string } | null;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  photos: string[];
};
export const Route = createFileRoute("/repairs/$issueId")({
  head: () => ({
    meta: [
      { title: "Truck repair · VHH Fleet" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: RepairPage,
});
async function result(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : "Could not complete this request. Please try again.",
    );
  return body;
}
export function RepairPage() {
  const { issueId } = Route.useParams();
  return <Repair key={issueId} issueId={issueId} />;
}

function RepairPhoto({ photo }: { photo: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo]);

  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        src={url}
        alt="Completed repair"
        className="aspect-square rounded-md object-cover"
      />
    </a>
  );
}

function Repair({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient();
  const viewId = useId();
  const link = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null),
    [grant, setGrant] = useState("");
  const [verificationError, setVerificationError] = useState(""),
    [busy, setBusy] = useState(false),
    [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState("");
  const endpoint = `/api/repairs/${encodeURIComponent(issueId)}`;
  useEffect(() => {
    link.current ??=
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    setToken(link.current);
  }, []);

  // This view's cache keys never include the bearer credentials.
  const issueKey = ["repair", issueId, viewId] as const;
  const authorization = `Bearer ${grant || token || ""}`;
  const issueQuery = useQuery({
    queryKey: issueKey,
    enabled: !!token,
    gcTime: 0,
    queryFn: async ({ signal }): Promise<Issue> =>
      result(
        await fetch(endpoint, {
          headers: { Authorization: authorization },
          cache: "no-store",
          signal,
        }),
      ),
  });
  const issue = issueQuery.data;
  const photoIds = issue?.photos ?? [];
  const photoQuery = useQuery({
    queryKey: [...issueKey, "photos", photoIds],
    enabled: !!token && photoIds.length > 0,
    gcTime: 0,
    queryFn: ({ signal }) =>
      Promise.all(
        photoIds.map(async (id) => {
          const response = await fetch(`${endpoint}/photos/${id}`, {
            headers: { Authorization: authorization },
            cache: "no-store",
            signal,
          });
          if (!response.ok) throw new Error("Could not load a repair photo.");
          return { id, photo: await response.blob() };
        }),
      ),
  });
  const error =
    verificationError ||
    (token === "" && "Open the repair link from the mechanics WhatsApp group.") ||
    issueQuery.error?.message ||
    photoQuery.error?.message;

  async function auth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setVerificationError("");
    try {
      const data = await result(
        await fetch(`${endpoint}/otp${challenge ? "/verify" : ""}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            challenge
              ? { challengeId: challenge, code }
              : { phone: phone.replace(/[\s()-]/g, "") },
          ),
        }),
      );
      if (challenge) setGrant(data.token);
      else setChallenge(data.challengeId);
    } catch (cause) {
      setVerificationError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="flex items-center gap-3">
          <img src="/design/monogram.svg" alt="VHH" className="size-10" />
          <span className="font-semibold">VHH Fleet</span>
        </header>
        <Card className="gap-6 p-6 shadow-none sm:p-8">
          <div className="flex items-center gap-3">
            {issue?.resolvedAt ? (
              <CheckCircle2 className="size-6 text-green-700" />
            ) : (
              <Wrench className="size-6 text-primary" />
            )}
            <h1 className="text-xl font-semibold">
              {issue?.resolvedAt ? "Issue resolved" : "Truck repair"}
            </h1>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!issue && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading issue…
            </p>
          )}
          {issue && (
            <>
              <div className="space-y-2">
                <h2 className="font-semibold">
                  {issue.truck?.registration}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {issue.truck?.identifier}
                  </span>
                </h2>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {issue.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reported {new Date(issue.createdAt).toLocaleString("en-ZA")}
                </p>
              </div>
              {issue.resolvedAt ? (
                <div className="space-y-4">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {issue.resolutionNote}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {photoQuery.data?.map(({ id, photo }) => (
                      <RepairPhoto key={id} photo={photo} />
                    ))}
                  </div>
                </div>
              ) : grant ? (
                <RepairForm
                  endpoint={`${endpoint}/resolve`}
                  headers={{ Authorization: `Bearer ${grant}` }}
                  askName
                  onSaved={() =>
                    queryClient.invalidateQueries({
                      queryKey: issueKey,
                      exact: true,
                    })
                  }
                />
              ) : (
                <form onSubmit={auth} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Verify your WhatsApp number to record the repair.
                  </p>
                  <fieldset disabled={busy} className="space-y-4">
                    {!challenge ? (
                      <div className="space-y-2">
                        <Label htmlFor="phone">WhatsApp number</Label>
                        <Input
                          id="phone"
                          type="tel"
                          autoComplete="tel"
                          placeholder="+27"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="code">Code sent to {phone}</Label>
                        <Input
                          id="code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          required
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <Button>
                        {busy
                          ? "Please wait…"
                          : challenge
                            ? "Verify code"
                            : "Send WhatsApp code"}
                      </Button>
                      {challenge && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setChallenge("");
                            setCode("");
                          }}
                        >
                          Request another code
                        </Button>
                      )}
                    </div>
                  </fieldset>
                </form>
              )}
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
