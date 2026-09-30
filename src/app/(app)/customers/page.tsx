import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <PlaceholderPage
      title="Customers"
      purpose="Customer master with divisions, locations, contacts, tax registrations and payment terms."
      phase={1}
      icon={Building2}
    />
  );
}
