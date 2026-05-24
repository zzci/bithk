import { Alert, AlertDescription } from "./alert";

// Thin convenience over the shadcn `Alert` primitive (destructive variant):
// renders nothing when there is no message, so call sites can pass a nullable
// error string directly. The styling lives in `Alert`, not here.
export function ErrorBanner({
  message,
  className,
}: {
  readonly message: string | null | undefined;
  readonly className?: string;
}) {
  if (!message)
    return null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
