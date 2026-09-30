import type { Metadata } from "next";

import { UsersTable } from "@/app/(app)/admin/users/users-table";
import type { UserRow } from "@/components/admin/role-manager";
import { PageHeader } from "@/components/page-header";
import { requireRoleOrRedirect } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin · Users" };

interface ProfileQueryRow {
  id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  user_roles: { role: string }[] | null;
}

export default async function AdminUsersPage() {
  await requireRoleOrRedirect(["admin"]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, is_active, user_roles(role)")
    .order("created_at", { ascending: true });

  const rows: UserRow[] = ((data ?? []) as ProfileQueryRow[]).map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    isActive: profile.is_active,
    roles: (profile.user_roles ?? []).map((entry) => entry.role),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users and roles"
        description="Add or remove roles. Every change requires a reason and is written to the audit log."
      />
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          Could not load users. Please refresh and try again.
        </p>
      ) : (
        <UsersTable rows={rows} />
      )}
    </div>
  );
}
