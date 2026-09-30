"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  matchProducts,
  saveRequirementLines,
  type RowError,
} from "@/lib/actions/requirement-lines";
import { parsePastedLines } from "@/lib/requirements/paste";
import { UOM_OPTIONS } from "@/lib/schemas/masters";

const MAX_LINES = 500;
const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 6;

export interface LineDraft {
  id?: string;
  line_no: number;
  customer_part_no: string;
  oem_part_no: string;
  internal_part_no: string;
  description: string;
  quantity_required: string;
  uom: string;
  required_delivery_date: string;
  line_notes: string;
  product_id?: string | null;
}

function emptyRow(lineNo: number): LineDraft {
  return {
    line_no: lineNo,
    customer_part_no: "",
    oem_part_no: "",
    internal_part_no: "",
    description: "",
    quantity_required: "",
    uom: "NO",
    required_delivery_date: "",
    line_notes: "",
    product_id: null,
  };
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fromServer(row: {
  id: string;
  line_no: number;
  customer_part_no: string | null;
  oem_part_no: string | null;
  internal_part_no: string | null;
  description: string;
  quantity_required: number;
  uom: string;
  required_delivery_date: string | null;
  line_notes: string | null;
  product_id: string | null;
}): LineDraft {
  return {
    id: row.id,
    line_no: row.line_no,
    customer_part_no: row.customer_part_no ?? "",
    oem_part_no: row.oem_part_no ?? "",
    internal_part_no: row.internal_part_no ?? "",
    description: row.description,
    quantity_required: String(row.quantity_required),
    uom: row.uom,
    required_delivery_date: row.required_delivery_date ?? "",
    line_notes: row.line_notes ?? "",
    product_id: row.product_id,
  };
}

export function LineGrid({
  requirementId,
  initialLines,
}: {
  requirementId: string;
  initialLines: Parameters<typeof fromServer>[0][];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<LineDraft[]>(() =>
    initialLines.map(fromServer),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const duplicateParts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of rows) {
      for (const value of [row.internal_part_no, row.customer_part_no, row.oem_part_no]) {
        const key = normalize(value);
        if (!key) continue;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    return new Set(
      Array.from(seen.entries())
        .filter(([, count]) => count > 1)
        .map(([key]) => key),
    );
  }, [rows]);

  const errorByLine = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of errors) {
      if (row.line_no != null) map.set(row.line_no, row.error);
    }
    return map;
  }, [errors]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    rows.length,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = rows.slice(start, end);

  function updateRow(index: number, patch: Partial<LineDraft>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    setDirty(true);
  }

  function addRow() {
    if (rows.length >= MAX_LINES) {
      toast.error(`Maximum ${MAX_LINES} lines reached.`);
      return;
    }
    setRows((current) => [...current, emptyRow(current.length + 1)]);
    setDirty(true);
  }

  function removeRow(index: number) {
    setRows((current) =>
      current
        .filter((_, i) => i !== index)
        .map((row, i) => ({ ...row, line_no: i + 1 })),
    );
    setDirty(true);
  }

  function applyPaste() {
    setPasteError(null);

    if (pasteText.trim().length === 0) {
      setPasteError("Nothing to paste.");
      return;
    }

    const { rows: parsedRaw, errors: localErrors } = parsePastedLines(
      pasteText,
      rows.length + 1,
    );
    let parsed: LineDraft[] = parsedRaw.map((row) => ({
      ...row,
      product_id: null,
    }));

    if (rows.length + parsed.length > MAX_LINES) {
      setPasteError(
        `That would exceed the ${MAX_LINES}-line limit. Only the first ${MAX_LINES - rows.length} rows were added.`,
      );
      parsed = parsed.slice(0, Math.max(0, MAX_LINES - rows.length));
    }

    if (parsed.length === 0) {
      setPasteError(localErrors[0] ?? "No valid rows found.");
      return;
    }

    setRows((current) => [...current, ...parsed]);
    setDirty(true);
    setPasteOpen(false);
    setPasteText("");
    if (localErrors.length > 0) {
      toast.warning(`${localErrors.length} pasted row(s) were skipped.`);
    } else {
      toast.success(`${parsed.length} rows added. Review and save.`);
    }
  }

  async function save() {
    const localErrors: RowError[] = [];
    const payload = rows.map((row) => {
      const qty = Number(row.quantity_required);
      if (!row.description.trim()) {
        localErrors.push({ line_no: row.line_no, error: "Description is required" });
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        localErrors.push({ line_no: row.line_no, error: "Quantity must be greater than zero" });
      }
      if (!row.uom.trim()) {
        localErrors.push({ line_no: row.line_no, error: "UoM is required" });
      }
      return {
        id: row.id,
        line_no: row.line_no,
        product_id: row.product_id ?? undefined,
        customer_part_no: row.customer_part_no,
        oem_part_no: row.oem_part_no,
        internal_part_no: row.internal_part_no,
        description: row.description,
        quantity_required: Number.isFinite(qty) ? qty : 0,
        uom: row.uom,
        required_delivery_date: row.required_delivery_date,
        line_notes: row.line_notes,
      };
    });

    if (localErrors.length > 0) {
      setErrors(localErrors);
      toast.error("Some rows still need attention.");
      return;
    }

    setSaving(true);
    setErrors([]);

    // Match part numbers against the product master before saving.
    const matches = await matchProducts(
      rows.flatMap((row) => [
        row.internal_part_no,
        row.customer_part_no,
        row.oem_part_no,
      ]),
    );
    for (const row of payload) {
      for (const value of [row.internal_part_no, row.customer_part_no, row.oem_part_no]) {
        const match = matches[normalize(value ?? "")];
        if (match) {
          row.product_id = match.productId;
          break;
        }
      }
    }

    const result = await saveRequirementLines({
      requirementId,
      lines: payload,
    });
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.errors.length > 0) {
      setErrors(result.errors);
      toast.error(
        `Saved ${result.saved} row(s); ${result.errors.length} row(s) failed.`,
      );
      return;
    }
    setDirty(false);
    setRows((current) => current.map((row, i) => ({ ...row, line_no: i + 1 })));
    toast.success(`Saved ${result.saved} line(s).`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="size-4" aria-hidden="true" />
          Add line
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)}>
          <ClipboardPaste className="size-4" aria-hidden="true" />
          Paste from spreadsheet
        </Button>
        <span className="text-muted-foreground text-sm">
          {rows.length} of {MAX_LINES} lines
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <span className="text-amber-600 text-sm">Unsaved changes</span>
          ) : null}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Save lines
          </Button>
        </div>
      </div>

      {duplicateParts.size > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          Possible duplicate part numbers in this requirement. Check the
          highlighted rows before saving.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Add or paste lines to get started.
        </div>
      ) : (
        <>
          {/* Desktop grid with a virtualised body */}
          <div className="hidden rounded-lg border md:block">
            <div
              ref={scrollRef}
              className="overflow-auto"
              style={{ maxHeight: VIEWPORT_HEIGHT }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <table className="w-full caption-bottom text-sm">
                <thead className="bg-background sticky top-0 z-10 [&_tr]:border-b">
                  <tr>
                    <Th className="w-12">#</Th>
                    <Th>Customer P/N</Th>
                    <Th>OEM P/N</Th>
                    <Th>Internal P/N</Th>
                    <Th className="min-w-48">Description</Th>
                    <Th className="w-24">Qty</Th>
                    <Th className="w-24">UoM</Th>
                    <Th className="w-36">Delivery</Th>
                    <Th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {start > 0 ? (
                    <tr aria-hidden="true">
                      <td colSpan={9} style={{ height: start * ROW_HEIGHT }} />
                    </tr>
                  ) : null}
                  {visible.map((row, i) => {
                    const index = start + i;
                    const rowError = errorByLine.get(row.line_no);
                    const duplicate =
                      duplicateParts.has(normalize(row.internal_part_no)) ||
                      duplicateParts.has(normalize(row.customer_part_no)) ||
                      duplicateParts.has(normalize(row.oem_part_no));
                    return (
                      <tr
                        key={row.id ?? `new-${index}`}
                        className={rowError ? "bg-red-50" : duplicate ? "bg-amber-50" : undefined}
                        style={{ height: ROW_HEIGHT }}
                      >
                        <td className="px-2 text-muted-foreground">{row.line_no}</td>
                        <td className="px-1">
                          <CellInput
                            value={row.customer_part_no}
                            onChange={(v) => updateRow(index, { customer_part_no: v })}
                          />
                        </td>
                        <td className="px-1">
                          <CellInput
                            value={row.oem_part_no}
                            onChange={(v) => updateRow(index, { oem_part_no: v })}
                          />
                        </td>
                        <td className="px-1">
                          <CellInput
                            value={row.internal_part_no}
                            onChange={(v) => updateRow(index, { internal_part_no: v })}
                          />
                        </td>
                        <td className="px-1">
                          <CellInput
                            value={row.description}
                            onChange={(v) => updateRow(index, { description: v })}
                          />
                          {rowError ? (
                            <p className="text-destructive px-1 text-xs">{rowError}</p>
                          ) : null}
                        </td>
                        <td className="px-1">
                          <CellInput
                            type="number"
                            value={row.quantity_required}
                            onChange={(v) => updateRow(index, { quantity_required: v })}
                          />
                        </td>
                        <td className="px-1">
                          <select
                            value={row.uom}
                            onChange={(event) => updateRow(index, { uom: event.target.value })}
                            className="border-input bg-background h-8 w-full rounded border px-1 text-sm"
                          >
                            {UOM_OPTIONS.map((uom) => (
                              <option key={uom} value={uom}>
                                {uom}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1">
                          <CellInput
                            type="date"
                            value={row.required_delivery_date}
                            onChange={(v) => updateRow(index, { required_delivery_date: v })}
                          />
                        </td>
                        <td className="px-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeRow(index)}
                            aria-label={`Remove line ${row.line_no}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {end < rows.length ? (
                    <tr aria-hidden="true">
                      <td colSpan={9} style={{ height: (rows.length - end) * ROW_HEIGHT }} />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {/* Phone stacked cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((row, index) => (
              <div key={row.id ?? `card-${index}`} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">Line {row.line_no}</span>
                  <Button size="icon" variant="ghost" onClick={() => removeRow(index)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <Input
                  placeholder="Description"
                  value={row.description}
                  onChange={(event) => updateRow(index, { description: event.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Customer P/N"
                    value={row.customer_part_no}
                    onChange={(event) => updateRow(index, { customer_part_no: event.target.value })}
                  />
                  <Input
                    placeholder="OEM P/N"
                    value={row.oem_part_no}
                    onChange={(event) => updateRow(index, { oem_part_no: event.target.value })}
                  />
                  <Input
                    placeholder="Internal P/N"
                    value={row.internal_part_no}
                    onChange={(event) => updateRow(index, { internal_part_no: event.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Qty"
                    value={row.quantity_required}
                    onChange={(event) => updateRow(index, { quantity_required: event.target.value })}
                  />
                  <select
                    value={row.uom}
                    onChange={(event) => updateRow(index, { uom: event.target.value })}
                    className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  >
                    {UOM_OPTIONS.map((uom) => (
                      <option key={uom} value={uom}>
                        {uom}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="date"
                    value={row.required_delivery_date}
                    onChange={(event) =>
                      updateRow(index, { required_delivery_date: event.target.value })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste lines</DialogTitle>
            <DialogDescription>
              Copy rows from a spreadsheet. Columns: customer P/N, OEM P/N,
              internal P/N, description, quantity, UoM, delivery date, notes.
              An optional leading line number is accepted.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={10}
            placeholder={"CUST-1\tOEM-1\tINT-1\tWidget\t100\tNO\t2026-04-01\t"}
          />
          {pasteError ? (
            <p role="alert" className="text-destructive text-sm">
              {pasteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyPaste}>Add rows</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-2 py-2 text-left align-middle font-medium ${className ?? ""}`}>
      {children}
    </th>
  );
}

function CellInput({
  value,
  onChange,
  type = "text",
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="border-input bg-background h-8 w-full rounded border px-1 text-sm"
    />
  );
}
