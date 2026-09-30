/**
 * Seed synthetic demo users (one per role) using the service-role key.
 *
 *   npm run seed:users
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * DEMO_USER_PASSWORD. Idempotent: safe to run repeatedly.
 *
 * This file deliberately creates its own Supabase client instead of importing
 * src/lib/supabase/admin.ts, because that module imports "server-only" which
 * throws outside a React Server Component context.
 */
import { createClient } from "@supabase/supabase-js";

type AppRole = "owner" | "sales" | "operations" | "finance" | "admin";

interface DemoUser {
  email: string;
  fullName: string;
  role: AppRole;
}

const DEMO_USERS: DemoUser[] = [
  { email: "owner@demo.local", fullName: "Demo Owner", role: "owner" },
  { email: "sales@demo.local", fullName: "Demo Sales", role: "sales" },
  {
    email: "operations@demo.local",
    fullName: "Demo Operations",
    role: "operations",
  },
  { email: "finance@demo.local", fullName: "Demo Finance", role: "finance" },
  { email: "admin@demo.local", fullName: "Demo Admin", role: "admin" },
];

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      // Node 20.12+ / 24: load a .env file into process.env.
      process.loadEnvFile(file);
    } catch {
      // File missing — ignore and fall back to the real environment.
    }
  }
}

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.DEMO_USER_PASSWORD;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local (see .env.example).",
    );
  }
  if (!password) {
    throw new Error(
      "Missing DEMO_USER_PASSWORD. Add it to .env.local before seeding demo users.",
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const usersByEmail = new Map(
    (existing?.users ?? []).map((u) => [u.email?.toLowerCase() ?? "", u]),
  );

  for (const demo of DEMO_USERS) {
    const existingUser = usersByEmail.get(demo.email);
    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
      const { error } = await supabase.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: demo.fullName },
      });
      if (error) {
        throw new Error(`Failed to update ${demo.email}: ${error.message}`);
      }
      console.log(`updated user  ${demo.email}`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: demo.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: demo.fullName },
      });
      if (error || !data.user) {
        throw new Error(
          `Failed to create ${demo.email}: ${error?.message ?? "no user returned"}`,
        );
      }
      userId = data.user.id;
      console.log(`created user  ${demo.email}`);
    }

    // Ensure the profile exists (the auth trigger creates it, but be explicit).
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert(
        { id: userId, full_name: demo.fullName, email: demo.email },
        { onConflict: "id" },
      );
    if (profileError) {
      throw new Error(
        `Failed to upsert profile for ${demo.email}: ${profileError.message}`,
      );
    }

    // Deterministic role assignment: clear then set the single expected role.
    const { error: clearError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (clearError) {
      throw new Error(
        `Failed to clear roles for ${demo.email}: ${clearError.message}`,
      );
    }
    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, role: demo.role });
    if (roleError) {
      throw new Error(
        `Failed to assign role ${demo.role} to ${demo.email}: ${roleError.message}`,
      );
    }
    console.log(`  role        ${demo.role}`);
  }

  console.log(`\nDone. ${DEMO_USERS.length} demo users ready (synthetic only).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
