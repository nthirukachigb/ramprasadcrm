import type { Metadata } from "next";
import { Sparkles } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Ask (AI)" };

export default function AskPage() {
  return (
    <PlaceholderPage
      title="Ask (AI)"
      purpose="Read-only, grounded plain-language questions over your own records. Feature-flagged and never writes data."
      phase={13}
      icon={Sparkles}
    />
  );
}
