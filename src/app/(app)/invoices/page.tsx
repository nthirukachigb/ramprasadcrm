import type { Metadata } from "next";
import { Receipt } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Invoices" };

export default function InvoicesPage() {
  return (
    <PlaceholderPage
      title="Invoices"
      purpose="Record invoices against PO lines, track balances and keep deductions transparent."
      phase={9}
      icon={Receipt}
    />
  );
}
