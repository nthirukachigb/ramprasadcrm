import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Timeline, type TimelineEvent } from "@/components/timeline/Timeline";
import { requireUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Requirement timeline" };

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: requirement } = await supabase
    .from("requirement")
    .select("id, internal_ref")
    .eq("id", id)
    .maybeSingle();
  if (!requirement) notFound();

  const { data: events } = await supabase
    .from("v_requirement_timeline")
    .select(
      "requirement_id, occurred_at, event_type, actor, summary, detail, source_table, source_id",
    )
    .eq("requirement_id", id)
    .order("occurred_at", { ascending: false });

  return (
    <div className="space-y-6">
      <Link
        href={`/requirements/${id}`}
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {requirement.internal_ref}
      </Link>
      <PageHeader
        title="Timeline"
        description="Every status change, document, approval and clarification for this requirement."
      />
      <Timeline events={(events ?? []) as TimelineEvent[]} />
    </div>
  );
}
