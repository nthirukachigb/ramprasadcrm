"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCustomerPo } from "@/lib/actions/po";

export function CreatePoButton({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await createCustomerPo({
      versionId,
      customerPoNumber: String(form.get("customerPoNumber") ?? ""),
      poDate: String(form.get("poDate") ?? "") || undefined,
      pdiRequired: form.get("pdiRequired") === "on",
      notes: String(form.get("notes") ?? "") || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Customer PO created.");
    setOpen(false);
    router.push(`/orders/${result.id}`);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <FilePlus2 className="size-4" aria-hidden="true" />
        Create PO
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create customer PO</DialogTitle>
              <DialogDescription>
                Pre-filled from the approved quotation. Edit the values to match the PO document.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="customerPoNumber">Customer PO number</Label>
              <Input id="customerPoNumber" name="customerPoNumber" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="poDate">PO date</Label>
              <Input id="poDate" name="poDate" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" name="notes" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="pdiRequired" className="size-4" />
              PDI required
            </label>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Create PO
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
