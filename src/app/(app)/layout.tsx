import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/auth/get-user";
import { getServerEnv } from "@/lib/env";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const { DEMO_MODE } = getServerEnv();

  return (
    <AppShell user={user} demoMode={DEMO_MODE}>
      {children}
    </AppShell>
  );
}
