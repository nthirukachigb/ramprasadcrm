import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { RuleActions } from "@/components/admin/RuleActions.client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Task rules & jobs" };

const RULE_JOB: Record<string, string | null> = {
  deadline_tbc: null,
  clarification_open: null,
  quotation_deadline: "quotation_deadlines",
  customer_no_response: "customer_no_response",
  oem_response_followup: "oem_response_followup",
  quotation_validity: "quotation_validity",
  commitment_expiry: "commitment_expiry",
};

export default async function AdminRulesPage() {
  const user = await requireUser();
  if (!user.roles.some((role) => ["owner", "admin"].includes(role))) {
    redirect("/dashboard");
  }
  const supabase = await createClient();

  const [rules, runs] = await Promise.all([
    supabase.from("task_rule").select("rule_id, name, description, enabled").order("rule_id"),
    supabase
      .from("job_run")
      .select("id, job_name, status, created_count, error, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Task rules & jobs"
        description="Toggle reminder rules and run the scheduled jobs manually. Jobs are idempotent."
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rules.data ?? []).map((rule) => (
              <TableRow key={rule.rule_id}>
                <TableCell className="font-medium">{rule.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {rule.description ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={rule.enabled ? "default" : "secondary"}>
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <RuleActions
                    ruleId={rule.rule_id}
                    enabled={rule.enabled}
                    jobName={RULE_JOB[rule.rule_id] ?? null}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Recent job runs</h2>
        {(runs.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No runs yet.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.job_name}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          run.status === "failed"
                            ? "border-transparent bg-red-100 text-red-800"
                            : run.status === "success"
                              ? "border-transparent bg-emerald-100 text-emerald-800"
                              : undefined
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{run.created_count}</TableCell>
                    <TableCell>{formatDate(run.started_at)}</TableCell>
                    <TableCell className="text-destructive max-w-64 truncate text-xs">
                      {run.error ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
