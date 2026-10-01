"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setTaskStatus } from "@/lib/actions/tasks";

export function TaskActions({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function set(status: "done" | "cancelled") {
    setBusy(true);
    const result = await setTaskStatus({ id: taskId, status });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => set("done")}>
        <Check className="size-4" aria-hidden="true" />
        Done
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => set("cancelled")}>
        <X className="size-4" aria-hidden="true" />
        Cancel
      </Button>
    </span>
  );
}
