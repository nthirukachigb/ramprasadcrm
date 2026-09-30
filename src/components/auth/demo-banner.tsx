import { FlaskConical } from "lucide-react";

/** Unmissable banner shown whenever the app runs in demo mode. */
export function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <FlaskConical className="size-3.5" aria-hidden="true" />
      Demo environment — synthetic data only
    </div>
  );
}
