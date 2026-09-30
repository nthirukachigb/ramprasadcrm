import type { Metadata } from "next";
import { BadgeIndianRupee } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Commission" };

export default function CommissionPage() {
  return (
    <PlaceholderPage
      title="Commission"
      purpose="Track commission agreements and raise a commission invoice to the OEM after the OEM-payment milestone."
      phase={9}
      icon={BadgeIndianRupee}
    />
  );
}
