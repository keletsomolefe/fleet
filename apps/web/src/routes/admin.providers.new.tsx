import { createFileRoute } from "@tanstack/react-router";
import { ServiceProviderForm } from "@/components/service-provider-form";
import { PageError } from "@/components/page-error";
import { can } from "@/lib/auth";

export const Route = createFileRoute("/admin/providers/new")({
  loader: ({ context }) => ({
    denied:
      !can(context.session, "service_providers.write") ||
      !can(context.session, "service_providers.read"),
  }),
  component: Page,
});
function Page() {
  const { session } = Route.useRouteContext();
  if (Route.useLoaderData().denied)
    return <PageError message="You do not have access to this page." />;
  return <ServiceProviderForm session={session} />;
}
