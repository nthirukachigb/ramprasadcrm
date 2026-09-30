import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RecordDialog } from "@/components/masters/record-dialog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
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

export const metadata: Metadata = { title: "Customer" };

interface Division {
  id: string;
  name: string;
  is_active: boolean;
}
interface Location {
  id: string;
  division_id: string | null;
  label: string | null;
  city: string | null;
  state: string | null;
  address_type: string;
  is_default: boolean;
}
interface Contact {
  id: string;
  full_name: string;
  designation: string | null;
  role: string | null;
  email: string | null;
  phone_e164: string | null;
}
interface Registration {
  id: string;
  registration_type: string;
  value_last4: string;
  valid_to: string | null;
}
interface PortalRef {
  id: string;
  portal_name: string;
  portal_url: string | null;
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customer")
    .select(
      "id, name, legal_name, customer_type, default_payment_terms, default_payment_terms_days, notes, is_active",
    )
    .eq("id", id)
    .maybeSingle();
  if (!customer) notFound();

  const [divisionsRes, locationsRes, contactsRes, registrationsRes, portalsRes] =
    await Promise.all([
      supabase
        .from("customer_division")
        .select("id, name, is_active")
        .eq("customer_id", id)
        .order("name"),
      supabase
        .from("customer_location")
        .select("id, division_id, label, city, state, address_type, is_default")
        .eq("customer_id", id),
      supabase
        .from("customer_contact")
        .select("id, full_name, designation, role, email, phone_e164")
        .eq("customer_id", id),
      supabase
        .from("tax_registration")
        .select("id, registration_type, value_last4, valid_to")
        .eq("customer_id", id),
      supabase
        .from("portal_reference")
        .select("id, portal_name, portal_url")
        .eq("customer_id", id),
    ]);

  const divisions = (divisionsRes.data ?? []) as Division[];
  const locations = (locationsRes.data ?? []) as Location[];
  const contacts = (contactsRes.data ?? []) as Contact[];
  // RLS returns an error for roles without access rather than rows.
  const registrations = registrationsRes.error
    ? null
    : ((registrationsRes.data ?? []) as Registration[]);
  const portals = portalsRes.error
    ? null
    : ((portalsRes.data ?? []) as PortalRef[]);

  const user = await getCurrentUser();
  const canSeeRegistration = hasAnyRole(user, ["owner", "finance", "admin"]);
  const canSeePortal = hasAnyRole(user, [
    "owner",
    "sales",
    "finance",
    "admin",
  ]);

  const divisionOptions = divisions.map((d) => ({ value: d.id, label: d.name }));
  const locationOptions = locations.map((l) => ({
    value: l.id,
    label: l.label ?? l.city ?? l.id.slice(0, 8),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={
          customer.legal_name ??
          customer.customer_type?.replace(/_/g, " ") ??
          "Customer organisation"
        }
        actions={
          <StatusBadge
            status={customer.is_active ? "active" : "inactive"}
            tone={customer.is_active ? "success" : "neutral"}
          />
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Payment terms</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-1 text-sm">
            <p>{customer.default_payment_terms ?? "—"}</p>
            <p>
              {customer.default_payment_terms_days != null
                ? `${customer.default_payment_terms_days} days`
                : "—"}
            </p>
            {customer.notes ? (
              <p className="pt-2 text-xs">{customer.notes}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Divisions</CardTitle>
            <RecordDialog
              formKey="customerDivision"
              defaults={{ customerId: id }}
              triggerVariant="outline"
            />
          </CardHeader>
          <CardContent>
            {divisions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No divisions yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {divisions.map((division) => (
                  <li key={division.id} className="flex justify-between">
                    <span>{division.name}</span>
                    <StatusBadge
                      status={division.is_active ? "active" : "inactive"}
                      tone={division.is_active ? "success" : "neutral"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Locations</CardTitle>
          <RecordDialog
            formKey="customerLocation"
            defaults={{ customerId: id }}
            options={{ divisionId: divisionOptions }}
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
                  <TableHead>State</TableHead>
                  <TableHead>Default</TableHead>
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
                    <TableCell>{location.state ?? "—"}</TableCell>
                    <TableCell>{location.is_default ? "Yes" : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Contacts</CardTitle>
          <RecordDialog
            formKey="customerContact"
            defaults={{ customerId: id }}
            options={{ locationId: locationOptions }}
            triggerVariant="outline"
          />
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No contacts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      {contact.full_name}
                      {contact.designation ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {contact.designation}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="capitalize">
                      {contact.role?.replace(/_/g, " ") ?? "—"}
                    </TableCell>
                    <TableCell>{contact.email ?? "—"}</TableCell>
                    <TableCell>{contact.phone_e164 ?? "—"}</TableCell>
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
            <CardTitle className="text-base">Tax registrations</CardTitle>
            {canSeeRegistration ? (
              <RecordDialog
                formKey="taxRegistration"
                defaults={{ customerId: id }}
                triggerVariant="outline"
              />
            ) : null}
          </CardHeader>
          <CardContent>
            {!canSeeRegistration ? (
              <p className="text-muted-foreground text-sm">
                Restricted to Owner, Finance and Admin.
              </p>
            ) : registrations && registrations.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Valid to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrations.map((registration) => (
                    <TableRow key={registration.id}>
                      <TableCell>{registration.registration_type}</TableCell>
                      <TableCell className="font-mono">
                        ••••{registration.value_last4}
                      </TableCell>
                      <TableCell>
                        {registration.valid_to
                          ? formatDate(registration.valid_to)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm">
                No registrations yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Portal references</CardTitle>
            {canSeePortal ? (
              <RecordDialog
                formKey="portalReference"
                defaults={{ customerId: id }}
                triggerVariant="outline"
              />
            ) : null}
          </CardHeader>
          <CardContent>
            {!canSeePortal ? (
              <p className="text-muted-foreground text-sm">
                Restricted to Owner, Sales, Finance and Admin.
              </p>
            ) : portals && portals.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {portals.map((portal) => (
                  <li key={portal.id}>
                    <span className="font-medium">{portal.portal_name}</span>
                    {portal.portal_url ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {portal.portal_url}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                No portal references yet. Credentials are never stored.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Link
        href="/customers"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        ← Back to customers
      </Link>
    </div>
  );
}
