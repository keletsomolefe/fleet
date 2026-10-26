import { createFileRoute, notFound } from "@tanstack/react-router";
import { navigation } from "@/components/admin-shell";
import { EmptyPage } from "@/components/empty-page";
import { PageError } from "@/components/page-error";
import { can } from "@/lib/auth";
import { deniedPage } from "@/lib/users";
import { getTransportPage, sections } from "@/lib/transport";
import { TransportPage } from "@/components/transport-page";

export const Route = createFileRoute("/admin/$section")({
  loader: async ({ params, context }) => {
    const group = navigation.find((g) =>
      g.items.some((i) => i.section === params.section),
    );
    const item = group?.items.find((i) => i.section === params.section);
    if (!item) throw notFound();
    const denied = !can(context.session, item.permission);
    if (denied) await deniedPage();
    return {
      title: item.title,
      group: group!.label,
      denied,
      section: params.section,
      transport:
        !denied && sections.includes(params.section)
          ? await getTransportPage({ data: params.section })
          : null,
    };
  },
  component: Section,
});
function Section() {
  const data = Route.useLoaderData();
  const session = Route.useRouteContext().session;
  if (data.denied)
    return <PageError message="You do not have access to this page." />;
  if (data.transport)
    return (
      <TransportPage
        section={data.section}
        data={data.transport}
        session={session}
      />
    );
  return <EmptyPage {...data} />;
}
