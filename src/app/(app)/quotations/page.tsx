import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Quotations" };

export default function QuotationsPage() {
  return (
    <PlaceholderPage
      title="Quotations"
      purpose="Build quotation versions from structured costs, compare history and require owner approval before submission."
      phase={5}
      icon={FileText}
    />
  );
}
