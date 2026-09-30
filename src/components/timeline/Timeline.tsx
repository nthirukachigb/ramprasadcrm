"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";

export interface TimelineEvent {
  requirement_id: string;
  occurred_at: string;
  event_type: string;
  actor: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  source_table: string;
  source_id: string | number;
}

const TYPE_LABELS: Record<string, string> = {
  status_change: "Status",
  audit_insert: "Created",
  audit_update: "Updated",
  line_insert: "Line added",
  line_update: "Line changed",
  line_delete: "Line removed",
  document: "Document",
  approval: "Approval",
  clarification: "Clarification",
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState("all");

  const types = useMemo(
    () => Array.from(new Set(events.map((event) => event.event_type))).sort(),
    [events],
  );

  const filtered = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.event_type === filter)),
    [events, filter],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="timeline-filter" className="text-sm font-medium">
          Filter
        </label>
        <select
          id="timeline-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="all">All activity</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type] ?? type}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-sm">
          {filtered.length} event(s)
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity yet.</p>
      ) : (
        <ol className="relative space-y-4 border-l pl-4">
          {filtered.map((event) => (
            <li key={`${event.source_table}-${event.source_id}`} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="capitalize">
                  {TYPE_LABELS[event.event_type] ?? event.event_type}
                </Badge>
                <span className="text-sm font-medium">{event.summary}</span>
              </div>
              <p className="text-muted-foreground text-xs">
                {formatDateTime(event.occurred_at)}
                {event.actor ? ` · ${event.actor.slice(0, 8)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
