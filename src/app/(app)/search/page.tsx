import type { Metadata } from "next";
import { Search } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <PlaceholderPage
      title="Search"
      purpose="Global search across records and comparable bid history, backed by Postgres full-text search."
      phase={11}
      icon={Search}
    />
  );
}
