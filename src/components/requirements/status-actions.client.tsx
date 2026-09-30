"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setRequirementStatus } from "@/lib/actions/requirement";
import { REASON_REQUIRED, nextStatuses } from "@/lib/requirements/status";
import { STATUS_LABELS } from "@/lib/schemas/requirement";

export function StatusActions({
  requirementId,
  status,
  canWrite,
}: {
  requirementId: string;
  status: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = nextStatuses(status).filter(
    (next) => next !== "not_pursued",
  );

  async function apply(toStatus: string, reasonText?: string) {
    setBusy(true);
    setError(null);
    const result = await setRequirementStatus({
      id: requirementId,
      toStatus,
      reason: reasonText,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Status moved to ${STATUS_LABELS[toStatus] ?? toStatus}`);
    setReasonFor(null);
    setReason("");
    setPending(null);
    router.refresh();
  }

  if (!canWrite || options.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((next) => (
        <Button
          key={next}
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (REASON_REQUIRED.includes(next)) {
              setReasonFor(next);
              setReason("");
              setError(null);
            } else {
              setPending(next);
              void apply(next);
            }
          }}
        >
          {busy && pending === next ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Move to {STATUS_LABELS[next] ?? next}
        </Button>
      ))}

      {error && !reasonFor ? (
        <span className="text-destructive text-sm">{error}</span>
      ) : null}

      <Dialog
        open={reasonFor !== null}
        onOpenChange={(open) => {
          if (!open) setReasonFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Move to {reasonFor ? STATUS_LABELS[reasonFor] ?? reasonFor : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="status-reason">Reason (recorded in the audit log)</Label>
            <Textarea
              id="status-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
            />
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || reason.trim().length < 3}
              onClick={() => reasonFor && apply(reasonFor, reason)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
