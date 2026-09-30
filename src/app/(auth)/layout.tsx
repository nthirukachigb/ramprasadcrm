import { DemoBanner } from "@/components/auth/demo-banner";
import { getServerEnv } from "@/lib/env";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { DEMO_MODE } = getServerEnv();
  return (
    <div className="flex min-h-svh flex-col">
      {DEMO_MODE ? <DemoBanner /> : null}
      <div className="flex flex-1 items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
}
