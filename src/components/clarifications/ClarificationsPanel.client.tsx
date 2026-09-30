"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createClarification,
  setClarificationStatus,
} from "@/lib/actions/requirement";
import { formatDate } from "@/lib/format";

export interface ClarificationRow {
  id: string;
  clarification_type: string;
  subject: string;
  detail: string | null;
  status: string;
  due_date: string | null;
  response_text: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  missing_specification: "Missing specification",
  missing_drawing: "Missing drawing",
  outdated_drawing: "Outdated drawing",
  part_number_discrepancy: "Part-number discrepancy",
  other: "Other",
};

export function ClarificationsPanel({
  requirementId,
  items,
  canWrite,
}: {
  requirementId: string;
  items: ClarificationRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [respondFor, setRespondFor] = useState<ClarificationRow | null>(null);
  const [response, setResponse] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await createClarification({
      requirementId,
      clarificationType: form.get("clarificationType"),
      subject: form.get("subject"),
      detail: form.get("detail"),
      dueDate: form.get("dueDate"),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Clarification recorded.");
    setOpen(false);
    router.refresh();
  }

  async function respond() {
    if (!respondFor) return;
    setBusy(true);
    const result = await setClarificationStatus({
      id: respondFor.id,
      requirementId,
      status: "responded",
      responseText: response,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Response recorded.");
    setRespondFor(null);
    setResponse("");
    router.refresh();
  }

  async function close(row: ClarificationRow) {
    const result = await setClarificationStatus({
      id: row.id,
      requirementId,
      status: "closed",
      responseText: row.response_text ?? undefined,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {canWrite ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="size-4" aria-hidden="true" />
              Add clarification
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={add} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Add clarification</DialogTitle>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="clarificationType">Type</Label>
                <select
                  id="clarificationType"
                  name="clarificationType"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" name="subject" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail">Detail</Label>
                <Textarea id="detail" name="detail" rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dueDate">Due date</Label>
                <Input id="dueDate" name="dueDate" type="date" />
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No clarifications yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => {
            const overdue =
              item.status === "open" && item.due_date !== null && item.due_date < today;
            return (
              <li
                key={item.id}
                className={`flex flex-wrap items-center gap-2 p-3 text-sm ${overdue ? "bg-amber-50" : ""}`}
              >
                <div>
                  <p className="font-medium">{item.subject}</p>
                  <p className="text-muted-foreground text-xs">
                    {TYPE_LABELS[item.clarification_type] ?? item.clarification_type}
                    {item.due_date ? ` · due ${formatDate(item.due_date)}` : ""}
                  </p>
                  {item.response_text ? (
                    <p className="mt-1 text-xs">Response: {item.response_text}</p>
                  ) : null}
                </div>
                <Badge
                  className="ml-auto"
                  variant={item.status === "open" ? "secondary" : "default"}
                >
                  {item.status}
                </Badge>
                {overdue ? (
                  <Badge className="border-transparent bg-amber-100 text-amber-900">
                    Overdue
                  </Badge>
                ) : null}
                {canWrite && item.status !== "closed" ? (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRespondFor(item);
                        setResponse(item.response_text ?? "");
                      }}
                    >
                      Respond
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => close(item)}>
                      Close
                    </Button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={respondFor !== null} onOpenChange={(o) => !o && setRespondFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clarification response</DialogTitle>
          </DialogHeader>
          <Textarea
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondFor(null)}>
              Cancel
            </Button>
            <Button disabled={busy || response.trim().length === 0} onClick={respond}>
              Save response
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
