"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LineImportForm({ requirementId }: { requirementId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ saved?: number; errors?: { row: number; message: string }[]; error?: string } | null>(null);

  async function submit() {
    const file = input.current?.files?.[0];
    if (!file) return setResult({ error: "Choose a workbook first." });
    setBusy(true);
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch(`/api/requirements/${requirementId}/lines/import`, { method: "POST", body: formData });
    setResult((await response.json()) as { saved?: number; errors?: { row: number; message: string }[]; error?: string });
    setBusy(false);
  }

  return (
    <section className="max-w-3xl rounded-xl border bg-card p-5 shadow-sm">
      <p className="text-muted-foreground text-sm">The header is detected from the first 15 rows. Rows with missing description, quantity or UoM are reported and are not appended.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="grid flex-1 gap-1 text-sm font-medium">Excel or CSV file<input ref={input} type="file" accept=".xls,.xlsx,.csv" className="h-10 rounded-md border bg-background px-3 py-2 font-normal" /></label>
        <Button type="button" onClick={submit} disabled={busy}><Upload className="size-4" aria-hidden="true" />Import valid rows</Button>
      </div>
      {result ? <div className="mt-4 space-y-2" role="status">{result.error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{result.error}</p> : <p className="rounded-md bg-muted p-3 text-sm">{result.saved ?? 0} rows appended. {result.errors?.length ?? 0} row errors.</p>}{result.errors?.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">{result.errors.map((error) => <li key={`${error.row}-${error.message}`}>Row {error.row}: {error.message}</li>)}</ul> : null}</div> : null}
    </section>
  );
}
