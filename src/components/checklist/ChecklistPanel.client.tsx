"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  requestChecklistWaiver,
  setChecklistItemStatus,
} from "@/lib/actions/checklist";

export interface ChecklistRow {
  id: string;
  label: string;
  is_mandatory: boolean;
  status: string;
  waiver_approval_id: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  required: "Required",
  prepared: "Prepared",
  attached: "Attached",
  waived: "Waived",
};

export function ChecklistPanel({
  requirementId,
  items,
  canWrite,
}: {
  requirementId: string;
  items: ChecklistRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [waiverFor, setWaiverFor] = useState<ChecklistRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const complete = items.filter((item) =>
    ["attached", "waived"].includes(item.status),
  ).length;
  const mandatoryOpen = items.filter(
    (item) => item.is_mandatory && !["attached", "waived"].includes(item.status),
  ).length;

  async function setStatus(row: ChecklistRow, status: "prepared" | "attached" | "required") {
    setBusyId(row.id);
    const result = await setChecklistItemStatus({
      id: row.id,
      requirementId,
      status,
    });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function requestWaiver() {
    if (!waiverFor) return;
    setBusyId(waiverFor.id);
    setError(null);
    const result = await requestChecklistWaiver({
      itemId: waiverFor.id,
      requirementId,
      reason,
    });
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Waiver sent to the Owner for approval.");
    setWaiverFor(null);
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {complete} of {items.length} complete
        </p>
        <p className="text-muted-foreground text-xs">
          {mandatoryOpen > 0
            ? `${mandatoryOpen} mandatory item(s) still open`
            : "All mandatory items complete"}
        </p>
      </div>
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={complete}
        aria-valuemin={0}
        aria-valuemax={items.length}
      >
        <div
          className="bg-emerald-500 h-full"
          style={{
            width: items.length ? `${(complete / items.length) * 100}%` : "0%",
          }}
        />
      </div>

      <ul className="divide-y rounded-lg border">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-2 p-3 text-sm"
          >
            <span className="font-medium">{item.label}</span>
            {item.is_mandatory ? (
              <Badge variant="secondary">Mandatory</Badge>
            ) : null}
            <Badge
              className={
                item.status === "attached" || item.status === "waived"
                  ? "border-transparent bg-emerald-100 text-emerald-800"
                  : "border-transparent bg-muted text-muted-foreground"
              }
            >
              {STATUS_LABELS[item.status] ?? item.status}
            </Badge>
            {canWrite ? (
              <span className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === item.id}
                  onClick={() => setStatus(item, "prepared")}
                >
                  Prepared
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === item.id}
                  onClick={() => setStatus(item, "attached")}
                >
                  Attached
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === item.id || item.status === "waived"}
                  onClick={() => {
                    setWaiverFor(item);
                    setReason("");
                    setError(null);
                  }}
                >
                  Waive
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog open={waiverFor !== null} onOpenChange={(open) => !open && setWaiverFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a waiver</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="waiver-reason">
              Why is {waiverFor?.label} being waived?
            </Label>
            <Textarea
              id="waiver-reason"
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
            <Button variant="outline" onClick={() => setWaiverFor(null)}>
              Cancel
            </Button>
            <Button disabled={reason.trim().length < 3} onClick={requestWaiver}>
              Send for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
