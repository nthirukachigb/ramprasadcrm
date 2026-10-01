"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";

import { commitImportBatch, requestImportSignoff, rollbackImportBatch } from "@/lib/actions/imports";
import { Button } from "@/components/ui/button";

interface Batch {
  id: string;
  source_file_name: string;
  template_code: string;
  status: string;
  row_count: number;
  blocking_error_count: number;
  warning_count: number;
  created_at: string;
}

export function ImportWizard({ initialBatches }: { initialBatches: Batch[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [templateCode, setTemplateCode] = useState("LINES_GENERIC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file) return setMessage("Choose an .xls, .xlsx or .csv file first.");
    setBusy(true);
    setMessage(null);
    const batchId = crypto.randomUUID();
    const formData = new FormData();
    formData.set("file", file);
    formData.set("templateCode", templateCode);
    const response = await fetch(`/api/imports/${batchId}`, { method: "POST", body: formData });
    const result = (await response.json()) as { rows?: number; blocking?: number; warnings?: number; error?: string };
    setMessage(response.ok ? `${result.rows ?? 0} rows staged. ${result.blocking ?? 0} blocking errors and ${result.warnings ?? 0} warnings.` : result.error ?? "Import failed.");
    setBusy(false);
    if (response.ok) window.location.reload();
  }

  async function runAction(action: "commit" | "rollback" | "signoff", id: string) {
    setBusy(true);
    const result = action === "commit" ? await commitImportBatch(id) : action === "rollback" ? await rollbackImportBatch(id) : await requestImportSignoff(id);
    setMessage(result.ok ? `${action === "commit" ? "Batch committed" : action === "rollback" ? "Batch rolled back" : "Owner sign-off requested"}.` : result.error);
    setBusy(false);
    if (result.ok) window.location.reload();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="mt-1 size-5 text-primary" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Stage a workbook</h2>
            <p className="text-muted-foreground text-sm">Synthetic fixtures only in the demo. Nothing is committed without validation and Owner/Admin control.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
          <label className="grid gap-1 text-sm font-medium">Template<select className="h-10 rounded-md border bg-background px-3 font-normal" value={templateCode} onChange={(event) => setTemplateCode(event.target.value)}><option value="LINES_GENERIC">Requirement lines</option><option value="ENQ_MASTER">Enquiry master</option><option value="ORDER_BOOK">Order book</option><option value="SALES_REG">Sales register</option><option value="PAYMENT_MASTER">Payment master</option><option value="CUSTOMER_MASTER">Customer master</option><option value="OEM_MASTER">OEM master</option><option value="APPROVALS">Approvals</option></select></label>
          <label className="grid gap-1 text-sm font-medium">Workbook<input ref={inputRef} type="file" accept=".xls,.xlsx,.csv" className="h-10 rounded-md border bg-background px-3 py-2 font-normal" /></label>
          <Button type="button" onClick={upload} disabled={busy}><Upload className="size-4" aria-hidden="true" />Stage file</Button>
        </div>
        {message ? <p className="mt-3 rounded-md bg-muted p-3 text-sm" role="status">{message}</p> : null}
      </section>
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Import batches</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">File</th><th className="p-2">Template</th><th className="p-2">Status</th><th className="p-2">Rows</th><th className="p-2">Errors</th><th className="p-2">Actions</th></tr></thead><tbody>{initialBatches.length === 0 ? <tr><td className="p-4 text-muted-foreground" colSpan={6}>No import batches yet.</td></tr> : initialBatches.map((batch) => <tr className="border-b last:border-0" key={batch.id}><td className="p-2">{batch.source_file_name}</td><td className="p-2">{batch.template_code}</td><td className="p-2"><span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs"><CheckCircle2 className="size-3" aria-hidden="true" />{batch.status}</span></td><td className="p-2">{batch.row_count}</td><td className="p-2">{batch.blocking_error_count} blocking / {batch.warning_count} warnings</td><td className="p-2"><div className="flex gap-2">{batch.status === "validated" ? <><Button size="sm" onClick={() => runAction("signoff", batch.id)} disabled={busy}>Request sign-off</Button><Button size="sm" variant="secondary" onClick={() => runAction("commit", batch.id)} disabled={busy}>Commit</Button></> : null}{batch.status !== "rolled_back" && batch.status !== "committed" ? <Button size="sm" variant="outline" onClick={() => runAction("rollback", batch.id)} disabled={busy}><RotateCcw className="size-4" aria-hidden="true" />Rollback</Button> : null}</div></td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
