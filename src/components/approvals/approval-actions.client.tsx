"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { decideApproval } from "@/lib/actions/approvals";

export function ApprovalActions({
  approvalId,
  canDecide,
}: {
  approvalId: string;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canDecide) return null;

  async function submit() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    const result = await decideApproval({ approvalId, decision, comment });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Approval ${decision}.`);
    setDecision(null);
    setComment("");
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => setDecision("approved")}>
        Approve
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDecision("rejected")}>
        Reject
      </Button>

      <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approved" ? "Approve" : "Reject"} this request
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="comment">Comment (required)</Label>
            <Textarea
              id="comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
            />
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button disabled={busy || comment.trim().length < 3} onClick={submit}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
