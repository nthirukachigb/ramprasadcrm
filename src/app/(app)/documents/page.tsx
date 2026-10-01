import type { Metadata } from "next";

import { ComplianceWorkspace, type CertificateRow, type DocumentSummary } from "@/components/documents/ComplianceWorkspace.client";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const supabase = await createClient();

  const [documentsResult, certificatesResult] = await Promise.all([
    supabase
      .from("document")
      .select("id, title, document_type, created_at, document_version:document_version(id, file_name, created_at)")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("compliance_approval")
      .select("id, authority, certificate_no, certificate_date, valid_until, apply_for_renewal_by")
      .order("valid_until", { ascending: false }),
  ]);

  const documents: DocumentSummary[] = (documentsResult.data ?? []).map((doc) => ({
    id: doc.id,
    title: doc.title,
    document_type: doc.document_type,
    created_at: doc.created_at,
    latest_file: ((doc.document_version ?? []) as { file_name?: string; created_at?: string }[])[0]?.file_name ?? "—",
  }));

  const certificates: CertificateRow[] = (certificatesResult.data ?? []).map((row) => ({
    id: row.id,
    authority: row.authority,
    certificate_no: row.certificate_no,
    certificate_date: row.certificate_date,
    valid_until: row.valid_until,
    apply_for_renewal_by: row.apply_for_renewal_by,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents and certificates"
        description="Private document vault, approval certificates, renewals and expiry visibility."
      />
      <ComplianceWorkspace documents={documents} certificates={certificates} canWrite={canWrite} />
    </div>
  );
}
