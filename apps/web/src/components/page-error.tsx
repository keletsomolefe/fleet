import { useRouter } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function PageError({ message }: { message: string }) {
  const router = useRouter()
  return (
    <div className="max-w-xl space-y-4">
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      {!message.includes('access') && (
        <Button variant="outline" onClick={() => void router.invalidate()}>
          Try again
        </Button>
      )}
    </div>
  )
}
