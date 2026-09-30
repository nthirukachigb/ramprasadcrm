"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmDocumentUpload,
  prepareDocumentUpload,
} from "@/lib/actions/documents";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";

export interface DocumentRow {
  documentId: string;
  title: string;
  documentType: string | null;
  fileName: string;
  scanStatus: string;
  sizeBytes: number | null;
  createdAt: string | null;
}

export function DocumentsPanel({
  requirementId,
  documents,
  canWrite,
}: {
  requirementId: string;
  documents: DocumentRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const file = form.get("file") as File | null;
    const title = String(form.get("title") ?? "");
    const documentType = String(form.get("documentType") ?? "");

    if (!file || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }

    setBusy(true);
    setError(null);

    const prepared = await prepareDocumentUpload({
      title: title || file.name,
      documentType,
      entityType: "requirement",
      entityId: requirementId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    if (!prepared.ok) {
      setBusy(false);
      setError(prepared.error);
      return;
    }

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(prepared.bucket)
      .uploadToSignedUrl(prepared.path, prepared.token, file);

    if (uploadError) {
      setBusy(false);
      setError("The upload failed. Please try again.");
      return;
    }

    await confirmDocumentUpload({ versionId: prepared.versionId, requirementId });
    setBusy(false);
    toast.success("Document uploaded. It is marked unscanned.");
    formEl.reset();
    router.refresh();
  }

  async function download(documentId: string) {
    setDownloading(documentId);
    try {
      const response = await fetch(`/api/files/${documentId}/url`);
      if (!response.ok) {
        toast.error("Could not create a download link.");
        return;
      }
      const { url } = (await response.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <form onSubmit={upload} className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Tender document" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="documentType">Type</Label>
            <Input id="documentType" name="documentType" placeholder="tender" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="file">File (PDF, image, XLSX, DOCX, CSV)</Label>
            <Input id="file" name="file" type="file" />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              Upload document
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm sm:col-span-3">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {documents.length === 0 ? (
        <p className="text-muted-foreground text-sm">No documents attached.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <li
              key={doc.documentId}
              className="flex flex-wrap items-center gap-2 p-3 text-sm"
            >
              <div>
                <p className="font-medium">{doc.title}</p>
                <p className="text-muted-foreground text-xs">
                  {doc.fileName}
                  {doc.createdAt ? ` · ${formatDate(doc.createdAt)}` : ""}
                </p>
              </div>
              {doc.scanStatus === "unscanned" ? (
                <Badge className="border-transparent bg-amber-100 text-amber-900">
                  Unscanned
                </Badge>
              ) : (
                <Badge variant="secondary">{doc.scanStatus}</Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={downloading === doc.documentId}
                onClick={() => download(doc.documentId)}
              >
                {downloading === doc.documentId ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        Files are scanned for malware? Not yet — this demo stores uploads as
        “unscanned” and shows a warning. Downloads use a short-lived signed URL.
      </p>
    </div>
  );
}
