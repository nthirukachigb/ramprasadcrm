"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { checkUpload, signedUrlTtlSeconds } from "@/lib/platform/storage";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type DocumentResult =
  | {
      ok: true;
      documentId: string;
      versionId: string;
      bucket: string;
      path: string;
      token: string;
      signedUrl: string;
    }
  | { ok: false; error: string };

export interface PrepareUploadInput {
  title: string;
  documentType?: string;
  entityType?: string;
  entityId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Validate the file, create the metadata rows and return a short-lived signed
 * upload URL. The client uploads directly to Storage with that URL.
 */
export async function prepareDocumentUpload(
  input: PrepareUploadInput,
): Promise<DocumentResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to upload files." };
  }
  if (!input.title.trim()) {
    return { ok: false, error: "A document title is required." };
  }

  const check = checkUpload(input.fileName, input.mimeType, input.sizeBytes);
  if (!check.ok) {
    return { ok: false, error: check.error ?? "This file cannot be uploaded." };
  }

  const supabase = await createClient();

  const { data: document, error: documentError } = await supabase
    .from("document")
    .insert({
      title: input.title.trim(),
      document_type: input.documentType?.trim() || null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (documentError || !document) {
    return { ok: false, error: "Could not create the document record." };
  }

  // Path has no customer names: {document_id}/{version}/{random}.{ext}
  const objectPath = `${document.id}/1/${randomUUID()}.${check.extension}`;

  const { data: version, error: versionError } = await supabase
    .from("document_version")
    .insert({
      document_id: document.id,
      version_no: 1,
      bucket_id: "documents",
      object_path: objectPath,
      file_name: input.fileName,
      mime_type: input.mimeType || null,
      size_bytes: input.sizeBytes,
      scan_status: "unscanned",
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (versionError || !version) {
    return { ok: false, error: "Could not create the document version." };
  }

  if (input.entityType && input.entityId) {
    const { error: linkError } = await supabase.from("document_link").insert({
      document_id: document.id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      linked_by: user.id,
    });
    if (linkError) {
      return {
        ok: false,
        error: "The document cannot be linked to this record.",
      };
    }
  }

  const { data: signed, error: signError } = await supabase.storage
    .from("documents")
    .createSignedUploadUrl(objectPath);
  if (signError || !signed) {
    return { ok: false, error: "Could not prepare the upload. Try again." };
  }

  return {
    ok: true,
    documentId: document.id,
    versionId: version.id,
    bucket: "documents",
    path: objectPath,
    token: signed.token,
    signedUrl: signed.signedUrl,
  };
}

export async function confirmDocumentUpload(input: {
  versionId: string;
  requirementId?: string;
  sha256?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_version")
    .update({ sha256: input.sha256 ?? null })
    .eq("id", input.versionId);
  if (error) return { ok: false, error: "Could not confirm the upload." };

  if (input.requirementId) {
    revalidatePath(`/requirements/${input.requirementId}`);
  }
  revalidatePath("/documents");
  return { ok: true };
}

/** Soft-delete a document (no hard delete in the MVP). */
export async function archiveDocument(input: {
  documentId: string;
  requirementId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to archive files." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("document")
    .update({ is_active: false, updated_by: user.id })
    .eq("id", input.documentId);
  if (error) return { ok: false, error: "Could not archive the document." };

  if (input.requirementId) {
    revalidatePath(`/requirements/${input.requirementId}`);
  }
  revalidatePath("/documents");
  return { ok: true };
}

/**
 * RLS-checked signed download URL for the latest version of a document. The
 * route handler calls this and logs the access (T2.5).
 */
export async function getDocumentSignedUrl(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const supabase = await createClient();
  const { data: version, error } = await supabase
    .from("document_version")
    .select("bucket_id, object_path")
    .eq("document_id", documentId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !version) return { ok: false, error: "Not found" };

  const { data: signed, error: signError } = await supabase.storage
    .from(version.bucket_id)
    .createSignedUrl(version.object_path, signedUrlTtlSeconds(), {
      download: true,
    });
  if (signError || !signed) {
    return { ok: false, error: "Could not create a download link" };
  }

  await supabase.rpc("log_access", {
    p_action: "document_download",
    p_entity_type: "document",
    p_entity_id: documentId,
    p_metadata: { expires_in: signedUrlTtlSeconds() },
  });

  return { ok: true, url: signed.signedUrl };
}
