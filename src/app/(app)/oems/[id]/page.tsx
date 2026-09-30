import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordDialog } from "@/components/masters/record-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentUser, hasAnyRole } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Partner" };

interface PartnerProductRow {
  id: string;
  product_id: string;
  relationship_type: string;
  exclusive_representation: boolean;
  lead_time_days: number | null;
  approved_source: boolean;
}

function pretty(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: partner } = await supabase
    .from("partner")
    .select(
      "id, name, legal_name, country, vendor_code, is_defence_qualified, qualification_notes, notes, is_active",
    )
    .eq("id", id)
    .maybeSingle();
  if (!partner) notFound();

  const [
    typesRes,
    locationsRes,
    contactsRes,
    capabilitiesRes,
    agreementsRes,
    productLinksRes,
    bankRes,
    productsRes,
  ] = await Promise.all([
    supabase
      .from("partner_type_link")
      .select("partner_type")
      .eq("partner_id", id),
    supabase
      .from("partner_location")
      .select("id, label, address_type, city, state, gstin, is_default")
      .eq("partner_id", id),
    supabase
      .from("partner_contact")
      .select("id, full_name, designation, role, email, phone_e164")
      .eq("partner_id", id),
    supabase
      .from("partner_capability")
      .select("id, capability, notes")
      .eq("partner_id", id),
    supabase
      .from("commission_agreement")
      .select(
        "id, commission_percent, effective_from, effective_to, nda_status, approved_at",
      )
      .eq("partner_id", id)
      .order("effective_from", { ascending: false }),
    supabase
      .from("partner_product")
      .select(
        "id, product_id, relationship_type, exclusive_representation, lead_time_days, approved_source",
      )
      .eq("partner_id", id),
    supabase
      .from("partner_bank_account")
      .select("id, bank_name, branch, account_number_last4, ifsc_last4")
      .eq("partner_id", id),
    supabase
      .from("product")
      .select("id, internal_part_number, description")
      .order("internal_part_number"),
  ]);

  const types = ((typesRes.data ?? []) as { partner_type: string }[]).map(
    (t) => t.partner_type,
  );
  const locations = locationsRes.data ?? [];
  const contacts = contactsRes.data ?? [];
  const capabilities = capabilitiesRes.data ?? [];
  const agreements = agreementsRes.error ? null : (agreementsRes.data ?? []);
  const productLinks = (productLinksRes.data ?? []) as PartnerProductRow[];
  const bankAccounts = bankRes.error ? null : (bankRes.data ?? []);
  const products = (productsRes.data ?? []) as {
    id: string;
    internal_part_number: string;
    description: string;
  }[];

  const productOptions = products.map((p) => ({
    value: p.id,
    label: `${p.internal_part_number} — ${p.description}`,
  }));
  const productNames = new Map(
    products.map((p) => [p.id, p.internal_part_number]),
  );
  const locationOptions = (locations as { id: string; label: string | null; city: string | null }[]).map(
    (l) => ({ value: l.id, label: l.label ?? l.city ?? l.id.slice(0, 8) }),
  );

  const user = await getCurrentUser();
  const canFinance = hasAnyRole(user, ["owner", "finance", "admin"]);
  const canBank = hasAnyRole(user, ["owner", "finance"]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={partner.name}
        description={partner.legal_name ?? partner.country}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {types.map((type) => (
              <Badge key={type} variant="secondary" className="capitalize">
                {pretty(type)}
              </Badge>
            ))}
            <StatusBadge
              status={partner.is_active ? "active" : "inactive"}
              tone={partner.is_active ? "success" : "neutral"}
            />
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <dl className="space-y-2">
              <Row label="Country" value={partner.country} />
              <Row label="Vendor code" value={partner.vendor_code} />
              <Row
                label="Defence-qualified"
                value={partner.is_defence_qualified ? "Evidence on file" : "—"}
              />
            </dl>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Locations</CardTitle>
            <RecordDialog
              formKey="partnerLocation"
              defaults={{ partnerId: id }}
              triggerVariant="outline"
            />
          </CardHeader>
          <CardContent>
            {locations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No locations yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>GSTIN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locations.map((location) => (
                    <TableRow key={location.id}>
                      <TableCell>{location.label ?? "—"}</TableCell>
                      <TableCell className="capitalize">
                        {location.address_type}
                      </TableCell>
                      <TableCell>{location.city ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {location.gstin ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Contacts</CardTitle>
            <RecordDialog
              formKey="partnerContact"
              defaults={{ partnerId: id }}
              options={{ locationId: locationOptions }}
              triggerVariant="outline"
            />
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No contacts yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {contacts.map((contact) => (
                  <li key={contact.id}>
                    <span className="font-medium">{contact.full_name}</span>
                    {contact.designation ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {contact.designation}
                      </span>
                    ) : null}
                    <div className="text-muted-foreground text-xs">
                      {[contact.role, contact.email, contact.phone_e164]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Capabilities</CardTitle>
            <RecordDialog
              formKey="partnerCapability"
              defaults={{ partnerId: id }}
              triggerVariant="outline"
            />
          </CardHeader>
          <CardContent>
            {capabilities.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No capabilities recorded.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {capabilities.map((capability) => (
                  <li key={capability.id}>{capability.capability}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Product links</CardTitle>
          <RecordDialog
            formKey="partnerProduct"
            defaults={{ partnerId: id }}
            options={{ productId: productOptions }}
            triggerVariant="outline"
          />
        </CardHeader>
        <CardContent>
          {productLinks.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No products linked yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Exclusive</TableHead>
                  <TableHead>Lead time</TableHead>
                  <TableHead>Approved source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productLinks.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-mono">
                      {productNames.get(link.product_id) ?? "—"}
                    </TableCell>
                    <TableCell className="capitalize">
                      {pretty(link.relationship_type)}
                    </TableCell>
                    <TableCell>{link.exclusive_representation ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      {link.lead_time_days != null
                        ? `${link.lead_time_days} days`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {link.approved_source ? "Business-provided" : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Commission agreements</CardTitle>
            {canFinance ? (
              <RecordDialog
                formKey="commissionAgreement"
                defaults={{ partnerId: id }}
                triggerVariant="outline"
              />
            ) : null}
          </CardHeader>
          <CardContent>
            {!canFinance ? (
              <p className="text-muted-foreground text-sm">
                Restricted to Owner, Finance and Admin.
              </p>
            ) : agreements && agreements.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>%</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>NDA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agreements.map((agreement) => (
                    <TableRow key={agreement.id}>
                      <TableCell>{agreement.commission_percent}%</TableCell>
                      <TableCell>{formatDate(agreement.effective_from)}</TableCell>
                      <TableCell>
                        {agreement.effective_to
                          ? formatDate(agreement.effective_to)
                          : "Open"}
                      </TableCell>
                      <TableCell>{agreement.nda_status ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm">
                No agreements recorded.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Bank details</CardTitle>
            {canBank ? (
              <RecordDialog
                formKey="bankAccount"
                defaults={{ partnerId: id }}
                triggerVariant="outline"
              />
            ) : null}
          </CardHeader>
          <CardContent>
            {!canBank ? (
              <p className="text-muted-foreground text-sm">
                Restricted to Owner and Finance.
              </p>
            ) : bankAccounts && bankAccounts.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {bankAccounts.map((account) => (
                  <li key={account.id}>
                    <span className="font-medium">
                      {account.bank_name ?? "Bank account"}
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {" "}
                      · ••••{account.account_number_last4} · ••••
                      {account.ifsc_last4}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                No bank details recorded.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Link
        href="/oems"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        ← Back to partners
      </Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value ?? "—"}</dd>
    </div>
  );
}
