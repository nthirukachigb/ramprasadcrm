import type { Metadata } from "next";
import { Upload } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Imports" };

export default function ImportsPage() {
  return (
    <PlaceholderPage
      title="Imports"
      purpose="Controlled Excel import with staging, validation, a preview and owner sign-off before any data is committed."
      phase={14}
      icon={Upload}
    />
  );
}
