"use client";

import { ErrorState } from "@/components/error-state";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="This page could not be loaded"
      message="Something went wrong while loading this page. You can try again, and the reference below helps us trace it."
      reference={error.digest}
      onRetry={reset}
    />
  );
}
