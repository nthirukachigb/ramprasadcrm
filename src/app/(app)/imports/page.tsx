import type { Metadata } from "next";
import { FileSpreadsheet } from "lucide-react";

import { ImportWizard } from "@/components/admin/import-wizard.client";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage() {
  await requireRole(["admin", "owner"]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_batch")
    .select("id, source_file_name, template_code, status, row_count, blocking_error_count, warning_count, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader title="Imports" description="Controlled Excel import with row-level validation, staging, reconciliation and reversible commit." />
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" aria-hidden="true" /> .xls, .xlsx and .csv are accepted. Macro-enabled files and credentials are rejected.</div>
      <ImportWizard initialBatches={data ?? []} />
    </div>
  );
}
