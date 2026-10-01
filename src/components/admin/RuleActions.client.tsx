"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { runJob, setTaskRuleEnabled } from "@/lib/actions/tasks";

export function RuleActions({
  ruleId,
  enabled,
  jobName,
}: {
  ruleId: string;
  enabled: boolean;
  jobName: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const result = await setTaskRuleEnabled({ ruleId, enabled: !enabled });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function run() {
    if (!jobName) return;
    setBusy(true);
    const result = await runJob({ job: jobName });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Job ran; ${result.created} task(s) created.`);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>
        {enabled ? "Disable" : "Enable"}
      </Button>
      {jobName ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={run}>
          <Play className="size-4" aria-hidden="true" />
          Run now
        </Button>
      ) : null}
    </span>
  );
}
