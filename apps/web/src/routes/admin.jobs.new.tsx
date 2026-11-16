import { createFileRoute } from "@tanstack/react-router";
import { ServiceJobForm } from "@/components/service-job-form";
import { PageError } from "@/components/page-error";
import { can } from "@/lib/auth";

export const Route = createFileRoute("/admin/jobs/new")({
  loader: ({ context }) => ({
    denied:
      !can(context.session, "service_jobs.write") ||
      !can(context.session, "service_jobs.read"),
  }),
  component: Page,
});
function Page() {
  const { session } = Route.useRouteContext();
  if (Route.useLoaderData().denied)
    return <PageError message="You do not have access to this page." />;
  return <ServiceJobForm session={session} />;
}
