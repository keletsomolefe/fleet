import { createFileRoute, redirect } from "@tanstack/react-router";
import { EmptyPage } from "@/components/empty-page";
import { PageError } from "@/components/page-error";
import { can } from "@/lib/auth";
import { deniedPage } from "@/lib/users";

export const Route = createFileRoute("/admin/")({
  loader: ({ context }) => {
    if (can(context.session, "overview.read")) return { denied: false };
    if (can(context.session, "issues.read"))
      throw redirect({ to: "/admin/vehicle-disputes" });
    return deniedPage();
  },
  component: Overview,
});

function Overview() {
  if (Route.useLoaderData().denied)
    return <PageError message="You do not have access to this page." />;
  return <EmptyPage title="Fleet overview" overview />;
}
