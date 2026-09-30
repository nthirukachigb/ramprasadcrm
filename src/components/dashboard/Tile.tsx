import Link from "next/link";
import { Construction } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Tile({
  code,
  label,
  count,
  definition,
  href,
  asOf,
  className,
}: {
  code: string;
  label: string;
  count: number;
  definition: string;
  href?: string;
  asOf: string;
  className?: string;
}) {
  const body = (
    <Card className={cn(href && "hover:border-primary/50 transition-colors", className)}>
      <CardHeader>
        <CardDescription className="flex items-center justify-between">
          <span>{label}</span>
          <span className="text-muted-foreground text-xs">{code}</span>
        </CardDescription>
        <CardTitle className="text-3xl tracking-tight">{count}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-muted-foreground text-xs">{definition}</p>
        <p className="text-muted-foreground text-xs">As of {formatDate(asOf)}</p>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  return body;
}

export function PlannedTile({
  code,
  label,
  reason,
  className,
}: {
  code: string;
  label: string;
  reason: string;
  className?: string;
}) {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardHeader>
        <CardDescription className="flex items-center justify-between">
          <span>{label}</span>
          <span className="text-muted-foreground text-xs">{code}</span>
        </CardDescription>
        <CardTitle className="text-muted-foreground text-3xl tracking-tight">—</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground flex items-start gap-2 text-xs">
        <Construction className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{reason}</span>
      </CardContent>
    </Card>
  );
}
