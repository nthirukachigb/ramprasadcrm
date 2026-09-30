"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRequirement } from "@/lib/actions/requirement";
import {
  BID_TYPES,
  REQUIREMENT_TYPE_LABELS,
  REQUIREMENT_TYPES,
  SOURCE_CHANNEL_LABELS,
  SOURCE_CHANNELS,
  SUBMISSION_TYPES,
} from "@/lib/schemas/requirement";

export interface CustomerOption {
  id: string;
  name: string;
  divisions: { id: string; name: string }[];
  locations: { id: string; label: string }[];
}

export function RequirementForm({
  customers,
  users,
}: {
  customers: CustomerOption[];
  users: { id: string; fullName: string | null; email: string | null }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [deadlineTbc, setDeadlineTbc] = useState(false);

  const selected = customers.find((c) => c.id === customerId);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = {};
    form.forEach((value, key) => {
      values[key] = value;
    });
    values.deadlineTbc = deadlineTbc;
    values.staggeredDelivery = form.get("staggeredDelivery") === "on";

    const result = await createRequirement(values);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Requirement ${result.internalRef ?? ""} created`);
    router.push(`/requirements/${result.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Requirement type" required>
          <select
            name="requirementType"
            required
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {REQUIREMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {REQUIREMENT_TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Customer" required>
          <select
            name="customerId"
            required
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— select a customer —</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Customer reference" required>
          <Input name="customerReference" required />
        </Field>

        <Field label="Customer division">
          <select
            name="divisionId"
            disabled={!selected}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm disabled:opacity-50"
          >
            <option value="">— none —</option>
            {(selected?.divisions ?? []).map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Delivery location">
          <select
            name="locationId"
            disabled={!selected}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm disabled:opacity-50"
          >
            <option value="">— none —</option>
            {(selected?.locations ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Source channel" required>
          <select
            name="sourceChannel"
            required
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {SOURCE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {SOURCE_CHANNEL_LABELS[channel] ?? channel}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Project name">
          <Input name="projectName" />
        </Field>

        <Field label="Portal / GeM tender no.">
          <Input name="portalTenderNo" />
        </Field>

        <Field label="Enquiry date" required>
          <Input name="enquiryDate" type="date" required />
        </Field>

        <Field label="Received date">
          <Input name="receivedDate" type="date" />
        </Field>

        <Field label="Submission deadline">
          <Input
            name="submissionDeadline"
            type="datetime-local"
            disabled={deadlineTbc}
          />
        </Field>

        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={deadlineTbc}
              onChange={(event) => setDeadlineTbc(event.target.checked)}
              className="size-4 rounded border"
            />
            Deadline to be confirmed
          </label>
        </div>

        <Field label="Quotation validity required (days)">
          <Input name="quotationValidityRequiredDays" type="number" min="0" />
        </Field>

        <Field label="Bid type">
          <select
            name="bidType"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— none —</option>
            {BID_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Submission type">
          <select
            name="submissionType"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— none —</option>
            {SUBMISSION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Assigned to">
          <select
            name="assignedUserId"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— unassigned —</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName ?? user.email ?? user.id}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Estimated value (INR)">
          <Input name="estimatedValue" type="number" min="0" step="0.01" />
        </Field>

        <Field label="Required delivery summary" full>
          <Textarea name="requiredDeliverySummary" rows={2} />
        </Field>

        <Field label="Payment terms requested" full>
          <Textarea name="paymentTermsRequested" rows={2} />
        </Field>

        <Field label="Notes" full>
          <Textarea name="notes" rows={3} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="staggeredDelivery"
          className="size-4 rounded border"
        />
        Staggered delivery
      </label>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Create requirement
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
