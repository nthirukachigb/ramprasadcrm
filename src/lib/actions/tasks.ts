"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type TaskResult = { ok: true; id?: string } | { ok: false; error: string };

async function requireWriter(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to manage tasks." };
  }
  return { ok: true, userId: user.id };
}

export async function setTaskStatus(input: {
  id: string;
  status: "done" | "cancelled" | "open";
}): Promise<TaskResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from("task")
    .update({ status: input.status })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePath("/tasks");
  return { ok: true, id: input.id };
}

export async function createTask(input: {
  sourceEntityType: string;
  sourceEntityId: string;
  title: string;
  ownerUserId?: string;
  dueDate?: string;
  priority?: string;
}): Promise<TaskResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task")
    .insert({
      source_entity_type: input.sourceEntityType,
      source_entity_id: input.sourceEntityId,
      title: input.title,
      owner_user_id: input.ownerUserId ?? null,
      due_date: input.dueDate ?? null,
      priority: input.priority ?? "medium",
      created_by: g.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePath("/tasks");
  return { ok: true, id: data.id };
}

export async function markNotificationRead(input: {
  id: string;
}): Promise<TaskResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification")
    .update({ is_read: true })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  return { ok: true };
}

export async function setTaskRuleEnabled(input: {
  ruleId: string;
  enabled: boolean;
}): Promise<TaskResult> {
  const user = await getCurrentUser();
  if (!user || !user.roles.includes("admin")) {
    return { ok: false, error: "Only an Admin may change task rules." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("task_rule")
    .update({ enabled: input.enabled })
    .eq("rule_id", input.ruleId);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePath("/admin/rules");
  return { ok: true };
}

export async function runJob(input: {
  job: string;
}): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || !user.roles.some((r) => ["owner", "admin"].includes(r))) {
    return { ok: false, error: "Only the Owner or Admin may run a job." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_job", {
    p_job: input.job,
    p_triggered_by: user.email ?? "manual",
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePath("/admin/rules");
  revalidatePath("/tasks");
  return { ok: true, created: (data as number) ?? 0 };
}

export interface NotificationItem {
  id: string;
  notification_type: string;
  subject_type: string | null;
  subject_id: string | null;
  is_read: boolean;
  created_at: string;
}

export async function listNotifications(): Promise<{
  ok: true;
  items: NotificationItem[];
  unread: number;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: true, items: [], unread: 0 };
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification")
    .select("id, notification_type, subject_type, subject_id, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  const items = (data ?? []) as NotificationItem[];
  return { ok: true, items, unread: items.filter((item) => !item.is_read).length };
}
