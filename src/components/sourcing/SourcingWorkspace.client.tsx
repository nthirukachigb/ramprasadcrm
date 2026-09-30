"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  changeCommitment,
  confirmShortlist,
  createOemResponse,
  createSourcingRequest,
  proposeSelection,
  removeShortlistEntry,
  setSourcingRequestStatus,
  withdrawCommitment,
} from "@/lib/actions/sourcing";
import { formatDate, formatQty } from "@/lib/format";
import { SOURCING_STATUS_LABELS } from "@/lib/schemas/sourcing";

// --- types -----------------------------------------------------------------
interface LineRow {
  id: string;
  line_no: number;
  description: string;
  quantity_required: number;
  uom: string;
  customer_part_no: string | null;
  internal_part_no: string | null;
}
interface Suggestion {
  requirement_line_id: string;
  line_no: number;
  match_basis: string;
  partner_id: string;
  partner_name: string;
  relationship_type: string;
  exclusive_representation: boolean;
  approved_source: boolean;
  lead_time_days: number | null;
  moq: number | null;
}
interface ShortlistRow {
  id: string;
  requirement_line_id: string;
  partner_id: string;
  partner: { name: string } | null;
}
interface RequestLine {
  id: string;
  requirement_line_id: string;
  qty_requested: number;
  requirement_line: { line_no: number; description: string } | null;
}
interface RequestRow {
  id: string;
  partner_id: string;
  partner: { name: string } | null;
  request_date: string;
  response_due_date: string | null;
  channel: string | null;
  status: string;
  lines: RequestLine[];
}
interface CommitmentRow {
  id: string;
  requirement_line_id: string;
  requirement_line: { line_no: number } | null;
  partner_id: string;
  partner: { name: string } | null;
  qty_committed: number;
  version: number;
  status: string;
  commitment_date: string;
  valid_until: string | null;
  evidence_note: string | null;
  evidence_document_id: string | null;
}
interface SelectionRow {
  id: string;
  requirement_line_id: string;
  requirement_line: { line_no: number } | null;
  partner_id: string;
  partner: { name: string } | null;
  qty_allocated: number;
  status: string;
  approval_id: string | null;
}
interface ResponseLineRow {
  id: string;
  unit_price: number | null;
  lead_time_days: number | null;
  moq: number | null;
  validity_until: string | null;
  indications: { qty_available_indicated: number }[] | null;
  commitments:
    | { id: string; qty_committed: number; status: string; version: number; evidence_note: string | null }[]
    | null;
}
interface ResponseRow {
  id: string;
  request_id: string;
  partner: { name: string } | null;
  response_date: string;
  partner_quotation_no: string | null;
  status: string;
  notes: string | null;
  lines: ResponseLineRow[];
}

export interface SourcingWorkspaceProps {
  requirementId: string;
  canWrite: boolean;
  lines: LineRow[];
  suggestions: Suggestion[];
  shortlist: ShortlistRow[];
  partners: { id: string; name: string }[];
  requests: RequestRow[];
  responses: ResponseRow[];
  commitments: CommitmentRow[];
  selections: SelectionRow[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function SourcingWorkspace(props: SourcingWorkspaceProps) {
  const { requirementId, canWrite, lines, suggestions, shortlist, partners, requests, responses, commitments, selections } =
    props;

  const [shortlistState, setShortlistState] = useState(shortlist);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // confirmed partner ids per line, seeded from the shortlist
  const [selected, setSelected] = useState<Record<string, Set<string>>>(() => {
    const map: Record<string, Set<string>> = {};
    for (const row of shortlist) {
      (map[row.requirement_line_id] ??= new Set()).add(row.partner_id);
    }
    return map;
  });

  const byLine = useMemo(() => {
    const map = new Map<string, Suggestion[]>();
    for (const s of suggestions) {
      const list = map.get(s.requirement_line_id) ?? [];
      list.push(s);
      map.set(s.requirement_line_id, list);
    }
    return map;
  }, [suggestions]);

  const committedByLine = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of commitments) {
      if (c.status !== "active") continue;
      if (c.valid_until && c.valid_until < today()) continue;
      map.set(c.requirement_line_id, (map.get(c.requirement_line_id) ?? 0) + Number(c.qty_committed));
    }
    return map;
  }, [commitments]);

  async function saveShortlist() {
    const payloadSelections = lines
      .map((line) => ({
        requirementLineId: line.id,
        partnerIds: Array.from(selected[line.id] ?? []),
      }))
      .filter((s) => s.partnerIds.length > 0);
    if (payloadSelections.length === 0) {
      toast.error("Select at least one partner.");
      return;
    }
    setBusy(true);
    const result = await confirmShortlist({
      requirementId,
      selections: payloadSelections,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Shortlist confirmed.");
    router.refresh();
  }

  async function removeEntry(row: ShortlistRow) {
    const result = await removeShortlistEntry({ id: row.id, requirementId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setShortlistState((current) => current.filter((r) => r.id !== row.id));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* 1. Shortlist (T3.2) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Partner shortlist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Suggestions are labelled and read-only until you confirm. Nothing is
            saved automatically.
          </p>
          {lines.map((line) => {
            const candidates = byLine.get(line.id) ?? [];
            const confirmed = shortlistState.filter((s) => s.requirement_line_id === line.id);
            return (
              <div key={line.id} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  Line {line.line_no}: {line.description}
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatQty(line.quantity_required)} {line.uom}
                  </span>
                </p>
                {candidates.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    No mapped source for this line. Map a partner to the product in
                    the OEM master, or match the part number.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {candidates.map((candidate) => {
                      const key = `${line.id}:${candidate.partner_id}`;
                      const checked = (selected[line.id] ?? new Set()).has(
                        candidate.partner_id,
                      );
                      return (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={checked}
                            disabled={!canWrite}
                            onChange={(event) => {
                              setSelected((current) => {
                                const next = { ...current };
                                const set = new Set(next[line.id] ?? []);
                                if (event.target.checked) set.add(candidate.partner_id);
                                else set.delete(candidate.partner_id);
                                next[line.id] = set;
                                return next;
                              });
                            }}
                          />
                          {candidate.partner_name}
                          {candidate.exclusive_representation ? (
                            <Badge variant="secondary">Exclusive</Badge>
                          ) : null}
                          {candidate.approved_source ? (
                            <Badge className="border-transparent bg-emerald-100 text-emerald-800">
                              Approved source
                            </Badge>
                          ) : null}
                          <span className="text-muted-foreground text-xs">
                            {candidate.match_basis}
                            {candidate.lead_time_days != null
                              ? ` · ${candidate.lead_time_days}d`
                              : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {confirmed.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {confirmed.map((row) => (
                      <span
                        key={row.id}
                        className="bg-muted inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                      >
                        {row.partner?.name ?? row.partner_id.slice(0, 8)}
                        {canWrite ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => removeEntry(row)}
                            aria-label="Remove from shortlist"
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {canWrite ? (
            <Button size="sm" onClick={saveShortlist} disabled={busy}>
              Confirm shortlist
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* 2. Requests and responses (T3.3) */}
      <RequestsSection
        requirementId={requirementId}
        canWrite={canWrite}
        lines={lines}
        partners={partners}
        requests={requests}
      />

      {/* 2b. Captured responses */}
      <ResponsesCard responses={responses} />

      {/* 3. Commitments (T3.4) */}
      <CommitmentsSection
        canWrite={canWrite}
        commitments={commitments}
        committedByLine={committedByLine}
      />

      {/* 4. Selection (T3.5) */}
      <SelectionSection
        requirementId={requirementId}
        canWrite={canWrite}
        lines={lines}
        partners={partners}
        shortlist={shortlistState}
        selections={selections}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function ResponsesCard({ responses }: { responses: ResponseRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">OEM responses</CardTitle>
      </CardHeader>
      <CardContent>
        {responses.length === 0 ? (
          <p className="text-muted-foreground text-sm">No responses captured yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {responses.map((response) => (
              <li key={response.id} className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {response.partner?.name ?? "Partner"}
                  </span>
                  <Badge variant="secondary">
                    {SOURCING_STATUS_LABELS[response.status] ?? response.status}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(response.response_date)}
                    {response.partner_quotation_no
                      ? ` · ${response.partner_quotation_no}`
                      : ""}
                  </span>
                </div>
                <div className="grid gap-1 sm:grid-cols-2">
                  {response.lines.map((line) => {
                    const available = (line.indications ?? []).reduce(
                      (sum, i) => sum + Number(i.qty_available_indicated),
                      0,
                    );
                    const commitment = (line.commitments ?? [])[0];
                    return (
                      <div key={line.id} className="text-xs">
                        Available: {formatQty(available)}{" "}
                        <span className="text-muted-foreground">(informational)</span>
                        {" · "}
                        Firm:{" "}
                        {commitment
                          ? `${formatQty(commitment.qty_committed)} v${commitment.version} (${commitment.status})`
                          : "0"}
                        {commitment?.evidence_note ? (
                          <span className="text-muted-foreground">
                            {" · "}
                            {commitment.evidence_note}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function RequestsSection({
  requirementId,
  canWrite,
  lines,
  partners,
  requests,
}: {
  requirementId: string;
  canWrite: boolean;
  lines: LineRow[];
  partners: { id: string; name: string }[];
  requests: RequestRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responseFor, setResponseFor] = useState<RequestRow | null>(null);

  async function createRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const lineIds = form.getAll("lineIds").map(String);
    const result = await createSourcingRequest({
      requirementId,
      partnerId: form.get("partnerId"),
      responseDueDate: form.get("responseDueDate"),
      channel: form.get("channel"),
      lineIds,
      markSent: form.get("markSent") === "on",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Sourcing request created.");
    setOpen(false);
    router.refresh();
  }

  async function mark(id: string, status: "sent" | "cancelled") {
    const result = await setSourcingRequestStatus({ id, requirementId, status });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Sourcing requests</CardTitle>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            New request
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.length === 0 ? (
          <p className="text-muted-foreground text-sm">No requests yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {requests.map((request) => {
              const overdue =
                request.response_due_date !== null &&
                request.response_due_date < today() &&
                ["draft", "sent", "overdue"].includes(request.status);
              return (
                <li key={request.id} className="space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {request.partner?.name ?? "Partner"}
                    </span>
                    <Badge variant="secondary">
                      {SOURCING_STATUS_LABELS[request.status] ?? request.status}
                    </Badge>
                    {overdue ? (
                      <Badge className="border-transparent bg-amber-100 text-amber-900">
                        Overdue
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {formatDate(request.request_date)}
                      {request.response_due_date
                        ? ` · due ${formatDate(request.response_due_date)}`
                        : ""}
                    </span>
                    {canWrite ? (
                      <span className="ml-auto flex gap-1">
                        {request.status === "draft" ? (
                          <Button size="sm" variant="ghost" onClick={() => mark(request.id, "sent")}>
                            Mark sent
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setResponseFor(request)}
                        >
                          Add response
                        </Button>
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {request.lines.length} line(s):{" "}
                    {request.lines
                      .map((l) => `#${l.requirement_line?.line_no ?? "?"}`)
                      .join(", ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <form onSubmit={createRequest} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New sourcing request</DialogTitle>
              <DialogDescription>
                Create one request per partner. There is no automatic email; copy
                the details to send it yourself.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="partnerId">Partner</Label>
              <select
                id="partnerId"
                name="partnerId"
                required
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">— select —</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="responseDueDate">Response due</Label>
                <Input id="responseDueDate" name="responseDueDate" type="date" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="channel">Channel</Label>
                <Input id="channel" name="channel" placeholder="Email / portal" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Lines</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {lines.map((line) => (
                  <label key={line.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="lineIds" value={line.id} className="size-4" />
                    #{line.line_no} {line.description} ({formatQty(line.quantity_required)}{" "}
                    {line.uom})
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="markSent" className="size-4" />
              Mark as sent now
            </label>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Create request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ResponseDialog
        request={responseFor}
        onClose={() => setResponseFor(null)}
      />
    </Card>
  );
}

function ResponseDialog({
  request,
  onClose,
}: {
  request: RequestRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);

    const lines = request.lines.map((line) => ({
      sourcingRequestLineId: line.id,
      unitPrice: form.get(`price_${line.id}`),
      leadTimeDays: form.get(`lead_${line.id}`),
      moq: form.get(`moq_${line.id}`),
      validityUntil: form.get(`valid_${line.id}`),
      availability: form.get(`avail_${line.id}`),
      commitmentQty: form.get(`committed_${line.id}`),
      commitmentNote: form.get(`note_${line.id}`),
    }));

    const result = await createOemResponse({
      requestId: request.id,
      partnerId: request.partner_id,
      responseDate: form.get("responseDate") || today(),
      partnerQuotationNo: form.get("partnerQuotationNo"),
      notes: form.get("notes"),
      lines,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Response recorded.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              Response from {request?.partner?.name ?? "partner"}
            </DialogTitle>
            <DialogDescription>
              “Available” is informational and never counts as coverage. “Firm
              commitment” needs an evidence note and is versioned.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="responseDate">Response date</Label>
              <Input
                id="responseDate"
                name="responseDate"
                type="date"
                defaultValue={today()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partnerQuotationNo">Partner quotation no.</Label>
              <Input id="partnerQuotationNo" name="partnerQuotationNo" />
            </div>
          </div>

          <div className="space-y-3">
            {request?.lines.map((line) => (
              <div key={line.id} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">
                  #{line.requirement_line?.line_no} {line.requirement_line?.description}
                  <span className="text-muted-foreground">
                    {" "}
                    · requested {formatQty(line.qty_requested)}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Unit price" name={`price_${line.id}`} type="number" />
                  <Field label="Lead time (days)" name={`lead_${line.id}`} type="number" />
                  <Field label="MOQ" name={`moq_${line.id}`} type="number" />
                  <Field label="Valid until" name={`valid_${line.id}`} type="date" />
                  <Field label="Available (indication)" name={`avail_${line.id}`} type="number" />
                  <Field label="Firm commitment" name={`committed_${line.id}`} type="number" />
                  <div className="col-span-2">
                    <Field
                      label="Evidence note (required with a firm commitment)"
                      name={`note_${line.id}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              Save response
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommitmentsSection({
  canWrite,
  commitments,
  committedByLine,
}: {
  canWrite: boolean;
  commitments: CommitmentRow[];
  committedByLine: Map<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState<CommitmentRow | null>(null);
  const [withdraw, setWithdraw] = useState<CommitmentRow | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submitChange() {
    if (!change) return;
    setBusy(true);
    setError(null);
    const result = await changeCommitment({
      id: change.id,
      newQty: Number(value),
      reason,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Commitment changed; a new version was created.");
    setChange(null);
    router.refresh();
  }

  async function submitWithdraw() {
    if (!withdraw) return;
    setBusy(true);
    setError(null);
    const result = await withdrawCommitment({ id: withdraw.id, reason });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Commitment withdrawn.");
    setWithdraw(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Firm commitments</CardTitle>
      </CardHeader>
      <CardContent>
        {commitments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No commitments yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left">Line</th>
                  <th className="p-2 text-left">Partner</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-left">Version</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Valid until</th>
                  <th className="p-2 text-left">Evidence</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {commitments.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2">#{c.requirement_line?.line_no ?? "?"}</td>
                    <td className="p-2">{c.partner?.name ?? "—"}</td>
                    <td className="p-2 text-right">{formatQty(c.qty_committed)}</td>
                    <td className="p-2">v{c.version}</td>
                    <td className="p-2 capitalize">{c.status}</td>
                    <td className="p-2">
                      {c.valid_until ? formatDate(c.valid_until) : "—"}
                    </td>
                    <td className="text-muted-foreground max-w-48 truncate p-2 text-xs">
                      {c.evidence_note ?? (c.evidence_document_id ? "Document" : "—")}
                    </td>
                    <td className="p-2">
                      {canWrite && c.status === "active" ? (
                        <span className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setChange(c);
                              setValue(String(c.qty_committed));
                              setReason("");
                              setError(null);
                            }}
                          >
                            Change
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setWithdraw(c);
                              setReason("");
                              setError(null);
                            }}
                          >
                            Withdraw
                          </Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td className="p-2 font-medium" colSpan={2}>
                    Total firmly committed
                  </td>
                  <td className="p-2 text-right font-medium">
                    {formatQty(
                      Array.from(committedByLine.values()).reduce((a, b) => a + b, 0),
                    )}
                  </td>
                  <td className="p-2" colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <Dialog open={change !== null} onOpenChange={(o) => !o && setChange(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change commitment</DialogTitle>
              <DialogDescription>
                This creates a new version and marks the old one changed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="newQty">New committed quantity</Label>
              <Input
                id="newQty"
                type="number"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="changeReason">Reason (required)</Label>
              <Textarea
                id="changeReason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={busy || reason.trim().length < 3 || Number(value) <= 0}
                onClick={submitChange}
              >
                Save new version
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={withdraw !== null} onOpenChange={(o) => !o && setWithdraw(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Withdraw commitment</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="withdrawReason">Reason (required)</Label>
              <Textarea
                id="withdrawReason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button disabled={busy || reason.trim().length < 3} onClick={submitWithdraw}>
                Withdraw
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function SelectionSection({
  requirementId,
  canWrite,
  lines,
  partners,
  shortlist,
  selections,
}: {
  requirementId: string;
  canWrite: boolean;
  lines: LineRow[];
  partners: { id: string; name: string }[];
  shortlist: ShortlistRow[];
  selections: SelectionRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await proposeSelection({
      requirementId,
      requirementLineId: form.get("requirementLineId"),
      partnerId: form.get("partnerId"),
      qtyAllocated: form.get("qtyAllocated"),
      notes: form.get("notes"),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Selection proposed and sent to the Owner for approval.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">OEM selection</CardTitle>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Propose selection
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {selections.length === 0 ? (
          <p className="text-muted-foreground text-sm">No selections yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {selections.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span>
                  #{s.requirement_line?.line_no ?? "?"} · {s.partner?.name ?? "—"}
                </span>
                <span className="text-muted-foreground">
                  {formatQty(s.qty_allocated)} allocated
                </span>
                <Badge
                  className={
                    s.status === "approved"
                      ? "border-transparent bg-emerald-100 text-emerald-800"
                      : s.status === "rejected"
                        ? "border-transparent bg-red-100 text-red-800"
                        : "border-transparent bg-amber-100 text-amber-900"
                  }
                >
                  {SOURCING_STATUS_LABELS[s.status] ?? s.status}
                </Badge>
                {s.status === "proposed" ? (
                  <span className="text-muted-foreground text-xs">Awaiting Owner</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Propose OEM selection</DialogTitle>
              <DialogDescription>
                The Owner approves the selection in the approvals inbox. Allocation
                cannot exceed the firm commitment.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="requirementLineId">Line</Label>
              <select
                id="requirementLineId"
                name="requirementLineId"
                required
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">— select —</option>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    #{line.line_no} {line.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partnerId">Partner</Label>
              <select
                id="partnerId"
                name="partnerId"
                required
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">— select —</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                    {shortlist.some((s) => s.partner_id === partner.id)
                      ? " (shortlisted)"
                      : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qtyAllocated">Quantity allocated</Label>
              <Input id="qtyAllocated" name="qtyAllocated" type="number" min="0" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Propose and request approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Field({
  label,
  name,
  type = "text",
}: {
  label: string;
  name: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} className="text-xs">
        {label}
      </Label>
      <Input id={name} name={name} type={type} step={type === "number" ? "any" : undefined} />
    </div>
  );
}
