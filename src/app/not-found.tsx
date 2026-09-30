import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <FileQuestion className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          The page you are looking for does not exist or has moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
