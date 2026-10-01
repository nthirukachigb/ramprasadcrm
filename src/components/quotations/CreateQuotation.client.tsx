"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createQuotationFromRequirement } from "@/lib/actions/quotation";
import { formatQty } from "@/lib/format";

export function CreateQuotation({
  requirementId,
  lines,
}: {
  requirementId: string;
  lines: { id: string; line_no: number; description: string; quantity_required: number; uom: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lineIds = form.getAll("lineIds").map(String);
    if (lineIds.length === 0) {
      setError("Select at least one line.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createQuotationFromRequirement({ requirementId, lineIds });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Draft quotation created.");
    setOpen(false);
    router.push(`/quotations/${result.id}`);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        New quotation
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New quotation</DialogTitle>
              <DialogDescription>
                Choose the requirement lines to quote. The OEM cost is linked
                automatically from any recorded response.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  This requirement has no lines yet.
                </p>
              ) : (
                lines.map((line) => (
                  <label key={line.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="lineIds" value={line.id} className="size-4" defaultChecked />
                    #{line.line_no} {line.description} ({formatQty(line.quantity_required)} {line.uom})
                  </label>
                ))
              )}
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={busy || lines.length === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Create draft
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
