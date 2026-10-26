import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/page-header'

export function EmptyPage({
  title,
  group = 'Operations',
  overview = false,
}: {
  title: string
  group?: string
  overview?: boolean
}) {
  return (
    <>
      <PageHeader title={title} group={group} />
      <Card className="rounded-xl py-0 shadow-none">
        <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-full border bg-muted">
            <img src="/design/dispatch.svg" alt="" width={24} height={24} />
          </div>
          <h2 className="text-sm font-semibold">
            {overview ? 'No fleet activity yet' : 'No records yet'}
          </h2>
        </CardContent>
      </Card>
    </>
  )
}
