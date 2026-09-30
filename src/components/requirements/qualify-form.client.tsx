"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestQualification } from "@/lib/actions/requirement";

export function QualifyForm({
  requirementId,
  status,
  passPending,
}: {
  requirementId: string;
  status: string;
  passPending: boolean;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<"pursue" | "pass">("pursue");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (passPending) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        A Pass decision is waiting for Owner approval. It will move the
        requirement to “Not pursued” when approved.
      </p>
    );
  }

  if (status !== "received" && status !== "qualifying") {
    return (
      <p className="text-muted-foreground text-sm">
        Qualification is only available while a requirement is Received or
        Qualifying. The current status is “{status}”.
      </p>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await requestQualification({
      requirementId,
      decision,
      reason,
      note: reason,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(
      decision === "pursue"
        ? "Requirement qualified to pursue."
        : "Pass decision sent to the Owner for approval.",
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Decision</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="decision"
            checked={decision === "pursue"}
            onChange={() => setDecision("pursue")}
            className="size-4"
          />
          Pursue — qualify and start preparation
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="decision"
            checked={decision === "pass"}
            onChange={() => setDecision("pass")}
            className="size-4"
          />
          Pass — not pursued (needs Owner approval)
        </label>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="reason">
          {decision === "pass" ? "Pass reason (required)" : "Note"}
        </Label>
        <Textarea
          id="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
        />
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Button
        onClick={submit}
        disabled={busy || (decision === "pass" && reason.trim().length < 3)}
      >
        {decision === "pass" ? "Send for approval" : "Qualify to pursue"}
      </Button>
    </div>
  );
}
