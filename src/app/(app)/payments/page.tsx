import type { Metadata } from "next";
import { Wallet } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <PlaceholderPage
      title="Payments"
      purpose="Allocate receipts, record deductions and see ageing and outstanding balances."
      phase={9}
      icon={Wallet}
    />
  );
}
