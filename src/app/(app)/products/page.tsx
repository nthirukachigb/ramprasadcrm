import type { Metadata } from "next";
import { Boxes } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <PlaceholderPage
      title="Products"
      purpose="Products, normalised part numbers and OEM mappings, with required approvals."
      phase={1}
      icon={Boxes}
    />
  );
}
