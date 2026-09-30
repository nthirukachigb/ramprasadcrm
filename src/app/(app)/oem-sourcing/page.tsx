import type { Metadata } from "next";
import { Send } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "OEM Sourcing" };

export default function OemSourcingPage() {
  return (
    <PlaceholderPage
      title="OEM Sourcing"
      purpose="Shortlist OEMs, log sourcing requests and keep availability separate from firm quantity commitments."
      phase={3}
      icon={Send}
    />
  );
}
