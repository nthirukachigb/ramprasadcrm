"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signInAsDemo } from "@/lib/auth/actions";
import { DEMO_ROLES, type DemoRole } from "@/lib/schemas/auth";

const LABELS: Record<DemoRole, string> = {
  owner: "Owner",
  sales: "Sales",
  operations: "Operations",
  finance: "Finance",
  admin: "Admin",
};

export function DemoButtons() {
  const router = useRouter();
  const [pending, setPending] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(role: DemoRole) {
    setError(null);
    setPending(role);
    const result = await signInAsDemo({ role });
    if (!result.ok) {
      setError(result.error);
      setPending(null);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {DEMO_ROLES.map((role) => (
          <Button
            key={role}
            type="button"
            variant="outline"
            onClick={() => handleClick(role)}
            disabled={pending !== null}
          >
            {pending === role ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {LABELS[role]}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
