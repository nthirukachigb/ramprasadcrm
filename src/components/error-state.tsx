"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message?: string;
  reference?: string;
  onRetry?: () => void;
  className?: string;
}

/** Friendly, non-technical error panel with an optional retry action. */
export function ErrorState({
  title = "Something went wrong",
  message = "We could not load this page. Please try again.",
  reference,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "border-destructive/40 bg-destructive/5 flex flex-col items-center justify-center gap-2 rounded-lg border p-10 text-center",
        className,
      )}
    >
      <div className="text-destructive bg-destructive/10 flex size-10 items-center justify-center rounded-full">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      {reference ? (
        <p className="text-muted-foreground text-xs">Reference: {reference}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
