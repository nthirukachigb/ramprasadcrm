import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Requirements" };

export default function RequirementsPage() {
  return (
    <PlaceholderPage
      title="Requirements"
      purpose="Capture RFIs, RFQs, enquiries and tenders as one connected record with up to 500 structured line items."
      phase={2}
      icon={ClipboardList}
    />
  );
}
