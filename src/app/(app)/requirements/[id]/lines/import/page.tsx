import type { Metadata } from "next";
import Link from "next/link";

import { LineImportForm } from "@/components/requirements/line-import-form.client";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/get-user";

export const metadata: Metadata = { title: "Import requirement lines" };

export default async function RequirementLineImportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return (
    <div className="space-y-6">
      <PageHeader title="Import requirement lines" description="Append validated rows from an Excel or CSV file to this requirement." actions={<Link className="text-sm text-primary underline" href={`/requirements/${id}/lines`}>Back to lines</Link>} />
      <LineImportForm requirementId={id} />
    </div>
  );
}
