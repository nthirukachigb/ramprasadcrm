import type { Metadata } from "next";
import { AlertTriangle, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AI_TOOL_DEFINITIONS, isAiEnabled } from "@/lib/ai/tools";

export const metadata: Metadata = { title: "Ask (AI)" };

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string; from?: string; to?: string; status?: string }>;
}) {
  const params = await searchParams;
  const activeTool =
    AI_TOOL_DEFINITIONS.find((tool) => tool.name === params.tool) ??
    AI_TOOL_DEFINITIONS[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ask (AI)"
        description="Use the read-only catalogue to answer grounded business questions without writing data."
        actions={<Button variant="outline" size="sm"><Sparkles className="size-4" aria-hidden="true" />AI off by default</Button>}
      />

      {!isAiEnabled() ? (
        <div
          role="alert"
          className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/20 dark:text-amber-100 flex items-start gap-3 rounded-lg border p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            AI questions are switched off. The structured picker below remains
            available, and it follows the same read-only tool catalogue.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Structured query picker</CardTitle>
          <CardDescription>
            Questions map to a fixed read-only tool catalogue so the answer stays
            grounded in stored data and never writes SQL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form method="get" className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="tool" className="text-sm font-medium">
                Question type
              </label>
              <select
                id="tool"
                name="tool"
                defaultValue={activeTool.name}
                className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              >
                {AI_TOOL_DEFINITIONS.map((tool) => (
                  <option key={tool.name} value={tool.name}>
                    {tool.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="from" className="text-sm font-medium">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={params.from ?? ""}
                className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="to" className="text-sm font-medium">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={params.to ?? ""}
                className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              />
            </div>

            <div className="md:col-span-3 flex justify-end">
              <Button type="submit">Apply filters</Button>
            </div>
          </form>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-semibold">Selected tool: {activeTool.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeTool.description}
            </p>
          </div>

          <dl className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <dt className="text-sm font-medium text-muted-foreground">Definition</dt>
              <dd className="mt-2 text-sm">
                Uses the stored record set and the current user’s visibility rules.
              </dd>
            </div>
            <div className="rounded-lg border p-4">
              <dt className="text-sm font-medium text-muted-foreground">Filters</dt>
              <dd className="mt-2 text-sm">
                {params.status ?? "No extra filters"}
              </dd>
            </div>
            <div className="rounded-lg border p-4">
              <dt className="text-sm font-medium text-muted-foreground">Date range</dt>
              <dd className="mt-2 text-sm">
                {params.from || "—"} → {params.to || "—"}
              </dd>
            </div>
            <div className="rounded-lg border p-4">
              <dt className="text-sm font-medium text-muted-foreground">Result</dt>
              <dd className="mt-2 text-sm">No result loaded yet; select a tool and filters to inspect the answer.</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
