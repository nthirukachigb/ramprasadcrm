"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EvidenceBadge } from "@/components/status/EvidenceBadge";
import {
  addCertificateExtension,
  addCertificateRenewal,
  createComplianceApproval,
} from "@/lib/actions/documents";
import { formatDate } from "@/lib/format";

export interface DocumentSummary {
  id: string;
  title: string;
  document_type: string | null;
  created_at: string | null;
  latest_file: string;
}

export interface CertificateRow {
  id: string;
  authority: string | null;
  certificate_no: string;
  certificate_date: string | null;
  valid_until: string | null;
  apply_for_renewal_by: string | null;
}

export function ComplianceWorkspace({
  documents,
  certificates,
  canWrite,
}: {
  documents: DocumentSummary[];
  certificates: CertificateRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    toast.success(success);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Document vault</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {documents.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active documents are linked yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {documents.map((document) => (
                <li key={document.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <FolderOpen className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{document.title}</span>
                  <span className="text-muted-foreground">{document.document_type ?? "document"}</span>
                  <span className="text-muted-foreground">{document.latest_file}</span>
                  {document.created_at ? <span className="text-muted-foreground">{formatDate(document.created_at)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval certificates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {certificates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No compliance approvals recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {certificates.map((certificate) => {
                const effectiveDate = certificate.valid_until;
                const expired = effectiveDate && new Date(effectiveDate) < new Date();
                const expiringSoon =
                  effectiveDate &&
                  new Date(effectiveDate).getTime() - Date.now() < 45 * 24 * 60 * 60 * 1000;

                return (
                  <li key={certificate.id} className="rounded-md border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{certificate.certificate_no}</span>
                      <EvidenceBadge validTo={certificate.valid_until ?? null} />
                    </div>
                    <p className="text-muted-foreground mt-1">
                      {certificate.authority ?? "Authority not set"} · issued {certificate.certificate_date ? formatDate(certificate.certificate_date) : "—"}
                    </p>
                    <p className="text-muted-foreground">
                      valid until {certificate.valid_until ? formatDate(certificate.valid_until) : "—"}
                      {certificate.apply_for_renewal_by
                        ? ` · renewal by ${formatDate(certificate.apply_for_renewal_by)}`
                        : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite ? (
            <>
              <form
                className="grid gap-2 rounded-md border border-dashed p-2 sm:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  run(
                    () =>
                      createComplianceApproval({
                        authority: String(form.get("authority") ?? ""),
                        certificateNo: String(form.get("certificateNo") ?? ""),
                        certificateDate: String(form.get("certificateDate") ?? ""),
                        validUntil: String(form.get("validUntil") ?? ""),
                        applyForRenewalBy: String(form.get("applyForRenewalBy") ?? "") || null,
                        notes: String(form.get("notes") ?? "") || null,
                      }),
                    "Certificate recorded.",
                  );
                }}
              >
                <div className="space-y-1">
                  <Label className="text-xs">Authority</Label>
                  <Input name="authority" required className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Certificate no</Label>
                  <Input name="certificateNo" required className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Certificate date</Label>
                  <Input name="certificateDate" type="date" required className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valid until</Label>
                  <Input name="validUntil" type="date" required className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Renewal by</Label>
                  <Input name="applyForRenewalBy" type="date" className="h-9" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Notes</Label>
                  <Textarea name="notes" className="h-9" />
                </div>
                <div className="flex items-end">
                  <Button size="sm" type="submit" disabled={busy}>
                    <Plus className="size-4" aria-hidden="true" />
                    Add approval
                  </Button>
                </div>
              </form>

              <div className="grid gap-2 rounded-md border border-dashed p-2 md:grid-cols-2">
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const approvalId = String(form.get("approvalId") ?? "");
                    run(
                      () =>
                        addCertificateExtension({
                          approvalId,
                          seq: Number(form.get("seq") ?? 1),
                          extendedUntil: String(form.get("extendedUntil") ?? ""),
                          reason: String(form.get("reason") ?? "") || null,
                        }),
                      "Extension recorded.",
                    );
                  }}
                >
                  <p className="text-sm font-medium">Add extension</p>
                  <select name="approvalId" required className="border-input bg-background h-9 rounded-md border px-2 text-sm w-full">
                    {certificates.map((certificate) => (
                      <option key={certificate.id} value={certificate.id}>
                        {certificate.certificate_no}
                      </option>
                    ))}
                  </select>
                  <Input name="seq" type="number" min={1} max={2} defaultValue={1} className="h-9" />
                  <Input name="extendedUntil" type="date" required className="h-9" />
                  <Input name="reason" placeholder="Reason" className="h-9" />
                  <Button size="sm" type="submit" disabled={busy}>Add extension</Button>
                </form>

                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    run(
                      () =>
                        addCertificateRenewal({
                          predecessorId: String(form.get("predecessorId") ?? ""),
                          successorId: String(form.get("successorId") ?? ""),
                          renewalDate: String(form.get("renewalDate") ?? ""),
                          newValidUntil: String(form.get("newValidUntil") ?? ""),
                          reason: String(form.get("reason") ?? "") || null,
                        }),
                      "Renewal recorded.",
                    );
                  }}
                >
                  <p className="text-sm font-medium">Add renewal</p>
                  <select name="predecessorId" required className="border-input bg-background h-9 rounded-md border px-2 text-sm w-full">
                    {certificates.map((certificate) => (
                      <option key={certificate.id} value={certificate.id}>
                        {certificate.certificate_no}
                      </option>
                    ))}
                  </select>
                  <Input name="successorId" placeholder="Successor certificate id" className="h-9" />
                  <Input name="renewalDate" type="date" required className="h-9" />
                  <Input name="newValidUntil" type="date" required className="h-9" />
                  <Input name="reason" placeholder="Renewal reason" className="h-9" />
                  <Button size="sm" type="submit" disabled={busy}>Add renewal</Button>
                </form>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
