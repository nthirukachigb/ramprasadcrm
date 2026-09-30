import type { Metadata } from "next";
import { PackageCheck } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <PlaceholderPage
      title="Orders"
      purpose="Capture customer POs against an approved quotation, review mismatches and track line-level balances."
      phase={7}
      icon={PackageCheck}
    />
  );
}
