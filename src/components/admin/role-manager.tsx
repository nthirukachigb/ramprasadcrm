"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setUserRole } from "@/lib/admin/actions";
import { ROLE_VALUES } from "@/lib/schemas/admin";

export interface UserRow {
  id: string;
  fullName: string | null;
  email: string | null;
  isActive: boolean;
  roles: string[];
}

export function RoleManager({ user }: { user: UserRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] =
    useState<(typeof ROLE_VALUES)[number]>(ROLE_VALUES[0]);
  const [action, setAction] = useState<"add" | "remove">("add");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await setUserRole({
      userId: user.id,
      role,
      action,
      reason,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Role updated and recorded in the audit log.");
    setOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Manage roles
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>
              {user.fullName ?? user.email}. Every change is recorded in the
              audit log with your reason.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              value={role}
              onChange={(event) =>
                setRole(event.target.value as (typeof ROLE_VALUES)[number])
              }
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm capitalize"
            >
              {ROLE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="action">Action</Label>
            <select
              id="action"
              value={action}
              onChange={(event) =>
                setAction(event.target.value as "add" | "remove")
              }
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="add">Add role</option>
              <option value="remove">Remove role</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Granted finance access for invoice tracking"
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Confirm change
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
