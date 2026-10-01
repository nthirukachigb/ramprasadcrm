import type { Metadata } from "next";
import Link from "next/link";
import { CheckSquare } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TaskActions } from "@/components/tasks/TaskActions.client";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tasks" };

interface TaskRow {
  id: string;
  title: string;
  source_entity_type: string;
  source_entity_id: string;
  due_date: string | null;
  priority: string;
  status: string;
  owner: { full_name: string | null; email: string | null } | null;
}

function sourceHref(type: string, id: string): string | null {
  if (type === "requirement") return `/requirements/${id}`;
  if (type === "quotation") return `/quotations/${id}`;
  return null;
}

export default async function TasksPage() {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const supabase = await createClient();

  let query = supabase
    .from("task")
    .select(
      "id, title, source_entity_type, source_entity_id, due_date, priority, status, owner:owner_user_id(full_name, email)",
    )
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);
  // Sales sees their own tasks; Owner/Admin/Operations see all.
  if (user.roles.length === 1 && user.roles[0] === "sales") {
    query = query.eq("owner_user_id", user.id);
  }

  const { data } = await query;
  const rows = (data ?? []) as unknown as TaskRow[];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Follow-ups owned by a person. Reminders are in-app only; no external message is sent."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No tasks — you're up to date"
          purpose="Reminders such as deadline confirmations and OEM follow-ups appear here."
          icon={CheckSquare}
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((task) => {
            const overdue = task.due_date !== null && task.due_date < today;
            const href = sourceHref(task.source_entity_type, task.source_entity_id);
            return (
              <li key={task.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-48">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {task.owner?.full_name ?? task.owner?.email ?? "Unassigned"} ·{" "}
                    {task.source_entity_type.replace(/_/g, " ")}
                    {href ? (
                      <>
                        {" · "}
                        <Link href={href} className="text-primary underline-offset-4 hover:underline">
                          open
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {task.priority}
                </Badge>
                <span className={overdue ? "font-medium text-red-600" : "text-muted-foreground"}>
                  {task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}
                  {overdue ? " — overdue" : ""}
                </span>
                {canWrite ? (
                  <span className="ml-auto">
                    <TaskActions taskId={task.id} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
