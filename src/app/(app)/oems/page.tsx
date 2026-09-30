import type { Metadata } from "next";
import { Users } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "OEMs" };

export default function OemsPage() {
  return (
    <PlaceholderPage
      title="OEMs"
      purpose="Partner master for OEMs, suppliers, subcontractors, agencies and competitors, with capabilities and agreements."
      phase={1}
      icon={Users}
    />
  );
}
