"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addNegotiationEvent,
  createCustomerResponse,
  transitionResponse,
} from "@/lib/actions/response";
import { formatDate } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  clarification_requested: "Clarification requested",
  technical_clarification: "Technical clarification",
  commercial_negotiation: "Commercial negotiation",
  awaiting_decision: "Awaiting decision",
  won: "Won",
  partially_won: "Partially won",
  lost: "Lost",
  cancelled: "Cancelled",
};

const NEXT: Record<string, string[]> = {
  submitted: [
    "clarification_requested",
    "technical_clarification",
    "commercial_negotiation",
    "awaiting_decision",
    "won",
    "partially_won",
    "lost",
    "cancelled",
  ],
  clarification_requested: [
    "technical_clarification",
    "commercial_negotiation",
    "awaiting_decision",
    "cancelled",
  ],
  technical_clarification: ["commercial_negotiation", "awaiting_decision", "cancelled"],
  commercial_negotiation: ["awaiting_decision", "won", "partially_won", "lost", "cancelled"],
  awaiting_decision: ["won", "partially_won", "lost", "cancelled"],
};

const EVENT_TYPES = ["clarification", "technical", "commercial", "pnc", "other"];

export interface NegotiationRow {
  id: string;
  event_date: string;
  event_type: string;
  detail: string | null;
  price_change_requested: boolean;
  requested_price: number | null;
  agreed: boolean;
}

export function ResponsePanel({
  quotationId,
  versionId,
  response,
  events,
  approvedVersions,
  canWrite,
}: {
  quotationId: string;
  versionId: string;
  response: { id: string; status: string } | null;
  events: NegotiationRow[];
  approvedVersions: { id: string; version_no: number }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState({
    eventType: "commercial",
    detail: "",
    priceChangeRequested: false,
    requestedPrice: "",
    agreed: false,
    approvedVersionId: "",
  });

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

  if (!response) {
    return canWrite ? (
      <Button
        disabled={busy}
        onClick={() =>
          run(() => createCustomerResponse({ quotationId }), "Response tracking started.")
        }
      >
        Start response tracking
      </Button>
    ) : (
      <p className="text-muted-foreground text-sm">No customer response recorded.</p>
    );
  }

  const nextStatuses = NEXT[response.status] ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Current state</span>
        <Badge className="border-transparent bg-sky-100 text-sky-900">
          {STATUS_LABELS[response.status] ?? response.status}
        </Badge>
      </div>

      {canWrite && nextStatuses.length > 0 ? (
        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Reason (recorded in the status history)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((next) => (
              <Button
                key={next}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      transitionResponse({
                        id: response.id,
                        versionId,
                        toStatus: next as never,
                        reason,
                      }),
                    `Moved to ${STATUS_LABELS[next] ?? next}.`,
                  )
                }
              >
                {STATUS_LABELS[next] ?? next}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Record a negotiation event</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <select
              value={event.eventType}
              onChange={(e) => setEvent({ ...event, eventType: e.target.value })}
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Requested price</Label>
            <Input
              type="number"
              step="any"
              value={event.requestedPrice}
              onChange={(e) => setEvent({ ...event, requestedPrice: e.target.value })}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Approved version (PNC)</Label>
            <select
              value={event.approvedVersionId}
              onChange={(e) => setEvent({ ...event, approvedVersionId: e.target.value })}
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              <option value="">— none —</option>
              {approvedVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_no}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                className="size-4"
                checked={event.priceChangeRequested}
                onChange={(e) => setEvent({ ...event, priceChangeRequested: e.target.checked })}
              />
              Price change
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                className="size-4"
                checked={event.agreed}
                onChange={(e) => setEvent({ ...event, agreed: e.target.checked })}
              />
              Agreed
            </label>
          </div>
        </div>
        <Textarea
          rows={2}
          placeholder="Detail"
          value={event.detail}
          onChange={(e) => setEvent({ ...event, detail: e.target.value })}
        />
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                addNegotiationEvent({
                  customerResponseId: response.id,
                  versionId,
                  eventType: event.eventType,
                  detail: event.detail,
                  priceChangeRequested: event.priceChangeRequested,
                  requestedPrice: event.requestedPrice === "" ? null : Number(event.requestedPrice),
                  agreed: event.agreed,
                  approvedVersionId: event.approvedVersionId || null,
                }),
              "Negotiation event recorded.",
            )
          }
        >
          Add event
        </Button>
      </div>

      {events.length > 0 ? (
        <ul className="divide-y rounded-lg border text-sm">
          {events.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 p-2">
              <Badge variant="secondary">{row.event_type}</Badge>
              <span className="text-muted-foreground">{formatDate(row.event_date)}</span>
              <span className="flex-1">{row.detail ?? "—"}</span>
              {row.price_change_requested ? (
                <span className="text-muted-foreground text-xs">
                  price {row.requested_price ?? "?"} {row.agreed ? "(agreed)" : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
