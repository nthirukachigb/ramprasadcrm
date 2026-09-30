import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordDialog } from "@/components/masters/record-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatINR, formatQty } from "@/lib/format";
import {
  APPROVAL_STATUS_LABEL,
  certificateStatus,
  type ApprovalStatus,
} from "@/lib/masters/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Product" };

const STATUS_TONE: Record<ApprovalStatus, StatusTone> = {
  no_evidence: "neutral",
  expired: "danger",
  expiring: "warning",
  valid: "success",
};

interface PartNumber {
  id: string;
  part_number_type: string;
  value: string;
  customer_id: string | null;
  partner_id: string | null;
}
interface ApprovalRequirement {
  id: string;
  approval_type: string;
  is_required: boolean;
}
interface ApprovalCertificate {
  id: string;
  approval_type: string;
  certificate_number: string | null;
  valid_to: string | null;
}
interface PriceRow {
  id: string;
  price_type: string;
  amount: number;
  currency: string;
  valid_from: string | null;
  source: string | null;
}

function pretty(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("product")
    .select(
      "id, internal_part_number, description, category, uom, hsn_code, technical_specs, moq, lead_time_days, shelf_life_days, warranty_text, country_of_origin, export_restricted, standard_price, currency, is_active",
    )
    .eq("id", id)
    .maybeSingle();
  if (!product) notFound();

  const [partNumbersRes, requirementsRes, certsRes, pricesRes, customersRes, partnersRes] =
    await Promise.all([
      supabase
        .from("part_number")
        .select("id, part_number_type, value, customer_id, partner_id")
        .eq("product_id", id),
      supabase
        .from("product_approval_requirement")
        .select("id, approval_type, is_required")
        .eq("product_id", id),
      supabase
        .from("product_approval_certificate")
        .select("id, approval_type, certificate_number, valid_to")
        .eq("product_id", id),
      supabase
        .from("product_price")
        .select("id, price_type, amount, currency, valid_from, source")
        .eq("product_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("customer").select("id, name").order("name"),
      supabase.from("partner").select("id, name").order("name"),
    ]);

  const partNumbers = (partNumbersRes.data ?? []) as PartNumber[];
  const requirements = (requirementsRes.data ?? []) as ApprovalRequirement[];
  const certificates = (certsRes.data ?? []) as ApprovalCertificate[];
  const prices = (pricesRes.data ?? []) as PriceRow[];

  const customerOptions = (
    (customersRes.data ?? []) as { id: string; name: string }[]
  ).map((c) => ({ value: c.id, label: c.name }));
  const partnerOptions = (
    (partnersRes.data ?? []) as { id: string; name: string }[]
  ).map((p) => ({ value: p.id, label: p.name }));

  const customerNames = new Map(customerOptions.map((c) => [c.value, c.label]));
  const partnerNames = new Map(partnerOptions.map((p) => [p.value, p.label]));

  function certFor(approvalType: string): ApprovalCertificate | undefined {
    return certificates.find((c) => c.approval_type === approvalType);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.internal_part_number}
        description={product.description}
        actions={
          <StatusBadge
            status={product.is_active ? "active" : "inactive"}
            tone={product.is_active ? "success" : "neutral"}
          />
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Attributes</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Attribute label="Category" value={product.category} />
            <Attribute label="UoM" value={product.uom} />
            <Attribute label="HSN" value={product.hsn_code} />
            <Attribute
              label="MOQ"
              value={product.moq != null ? formatQty(product.moq) : null}
            />
            <Attribute
              label="Lead time"
              value={
                product.lead_time_days != null
                  ? `${product.lead_time_days} days`
                  : null
              }
            />
            <Attribute
              label="Shelf life"
              value={
                product.shelf_life_days != null
                  ? `${product.shelf_life_days} days`
                  : null
              }
            />
            <Attribute label="Warranty" value={product.warranty_text} />
            <Attribute label="Country of origin" value={product.country_of_origin} />
            <Attribute
              label="Export restricted"
              value={product.export_restricted ? "Yes" : "No"}
            />
            <Attribute
              label="Standard price"
              value={
                product.standard_price != null
                  ? formatINR(product.standard_price)
                  : null
              }
            />
            <Attribute label="Currency" value={product.currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Part numbers</CardTitle>
            <RecordDialog
              formKey="partNumber"
              defaults={{ productId: id }}
              options={{ customerId: customerOptions, partnerId: partnerOptions }}
              triggerVariant="outline"
            />
          </CardHeader>
          <CardContent>
            {partNumbers.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No part numbers yet. Internal, customer, OEM and manufacturer
                numbers can all be linked.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {partNumbers.map((part) => (
                  <li key={part.id}>
                    <span className="font-mono">{part.value}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {pretty(part.part_number_type)}
                      {part.customer_id
                        ? ` · ${customerNames.get(part.customer_id) ?? ""}`
                        : ""}
                      {part.partner_id
                        ? ` · ${partnerNames.get(part.partner_id) ?? ""}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            Approval requirements and evidence
          </CardTitle>
          <div className="flex gap-2">
            <RecordDialog
              formKey="approvalRequirement"
              defaults={{ productId: id }}
              triggerVariant="outline"
            />
            <RecordDialog
              formKey="approvalCertificate"
              defaults={{ productId: id }}
              triggerVariant="outline"
            />
          </div>
        </CardHeader>
        <CardContent>
          {requirements.length === 0 && certificates.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No approval requirements recorded.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Approval type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Evidence on file</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requirements.map((requirement) => {
                  const cert = certFor(requirement.approval_type);
                  const status: ApprovalStatus = cert
                    ? certificateStatus(cert.valid_to)
                    : "no_evidence";
                  return (
                    <TableRow key={requirement.id}>
                      <TableCell>{pretty(requirement.approval_type)}</TableCell>
                      <TableCell>{requirement.is_required ? "Yes" : "No"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {cert?.certificate_number ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={APPROVAL_STATUS_LABEL[status]}
                          tone={STATUS_TONE[status]}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {certificates
                  .filter(
                    (cert) =>
                      !requirements.some(
                        (r) => r.approval_type === cert.approval_type,
                      ),
                  )
                  .map((cert) => {
                    const status = certificateStatus(cert.valid_to);
                    return (
                      <TableRow key={cert.id}>
                        <TableCell>{pretty(cert.approval_type)}</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell className="font-mono text-xs">
                          {cert.certificate_number ?? "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={APPROVAL_STATUS_LABEL[status]}
                            tone={STATUS_TONE[status]}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Pricing history</CardTitle>
          <RecordDialog
            formKey="productPrice"
            defaults={{ productId: id }}
            options={{ partnerId: partnerOptions }}
            triggerVariant="outline"
          />
        </CardHeader>
        <CardContent>
          {prices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No price records yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Valid from</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map((price) => (
                  <TableRow key={price.id}>
                    <TableCell className="capitalize">
                      {pretty(price.price_type)}
                    </TableCell>
                    <TableCell>{formatINR(price.amount)}</TableCell>
                    <TableCell>
                      {price.valid_from ? formatDate(price.valid_from) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {price.source ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Link
        href="/products"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        ← Back to products
      </Link>
    </div>
  );
}

function Attribute({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase">{label}</p>
      <p>{value ?? "—"}</p>
    </div>
  );
}
