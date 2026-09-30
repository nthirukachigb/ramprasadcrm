import type { Metadata } from "next";
import { FolderOpen } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <PlaceholderPage
      title="Documents"
      purpose="A private document vault with signed downloads, certificates, extensions and expiry tracking."
      phase={10}
      icon={FolderOpen}
    />
  );
}
