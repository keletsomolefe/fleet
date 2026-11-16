import { useRouter } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'

export function PageError({ message }: { message: string }) {
  const router = useRouter()
  return (
    <div className="max-w-xl space-y-3">
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      {!message.includes('access') && !message.endsWith('not found.') && (
        <Button variant="outline" onClick={() => void router.invalidate()}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function MissingPage() {
  return (
    <main className="grid min-h-svh place-items-center bg-muted p-4">
      <div className="w-full max-w-md space-y-4">
        <img
          src="/design/monogram.svg"
          width={40}
          height={40}
          alt="VHH Fleet"
          className="mx-auto"
        />
        <Card className="py-0 shadow-none">
          <EmptyState
            icon="document"
            title={<h1>Page not found</h1>}
            description="Check the address or go back to Fleet."
            action={
              <Button asChild>
                <a href="/">Back to Fleet</a>
              </Button>
            }
          />
        </Card>
      </div>
    </main>
  )
}
