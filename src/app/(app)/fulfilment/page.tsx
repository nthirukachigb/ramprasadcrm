import type { Metadata } from "next";
import { Truck } from "lucide-react";

import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Fulfilment & PDI" };

export default function FulfilmentPage() {
  return (
    <PlaceholderPage
      title="Fulfilment & PDI"
      purpose="Track readiness, PDI calls and results, dispatch, delivery, acceptance and delivery risk."
      phase={8}
      icon={Truck}
    />
  );
}
