import { ShieldCheck } from "lucide-react";

import { DemoButtons } from "@/components/auth/demo-buttons";
import { LoginForm } from "@/components/auth/login-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getServerEnv } from "@/lib/env";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const { DEMO_MODE } = getServerEnv();

  return (
    <div className="w-full max-w-sm space-y-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold">Defence Contract CRM</h1>
        <p className="text-muted-foreground text-sm">
          Sign in to continue.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your work email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
        </CardContent>
      </Card>

      {DEMO_MODE ? (
        <Card>
          <CardHeader>
            <CardTitle>Demo access</CardTitle>
            <CardDescription>
              One click, one role. Synthetic data only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Separator />
            <DemoButtons />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
