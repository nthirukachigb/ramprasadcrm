import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import {
  RequirementForm,
  type CustomerOption,
} from "@/components/requirements/requirement-form";
import { requireRoleOrRedirect } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New requirement" };

export default async function NewRequirementPage() {
  await requireRoleOrRedirect(["owner", "sales", "operations", "admin"]);
  const supabase = await createClient();

  const [{ data: customers }, { data: profiles }] = await Promise.all([
    supabase
      .from("customer")
      .select(
        "id, name, division:customer_division(id, name, is_active), location:customer_location(id, label, address_type, is_active)",
      )
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
  ]);

  const options: CustomerOption[] = (customers ?? []).map((customer) => {
    const divisions = (
      (customer.division ?? []) as {
        id: string;
        name: string;
        is_active: boolean;
      }[]
    ).filter((division) => division.is_active);
    const locations = (
      (customer.location ?? []) as {
        id: string;
        label: string | null;
        address_type: string;
        is_active: boolean;
      }[]
    ).filter((location) => location.is_active);

    return {
      id: customer.id,
      name: customer.name,
      divisions: divisions.map((d) => ({ id: d.id, name: d.name })),
      locations: locations.map((l) => ({
        id: l.id,
        label: l.label ?? l.address_type,
      })),
    };
  });

  const users = (profiles ?? []).map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="New requirement"
        description="Capture the header now; add up to 500 line items on the requirement."
      />
      <RequirementForm customers={options} users={users} />
    </div>
  );
}
