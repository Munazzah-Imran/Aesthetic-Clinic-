"use client";

import { Siren } from "lucide-react";
import ModulePlaceholder from "@/components/dashboard/ModulePlaceholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="Emergency Alerts"
      subtitle="Monitor and respond to emergency alerts from patients."
      icon={Siren}
      bullets={[
        "Built on the same database and business isolation as the rest of the dashboard",
        "Navigation and theme are already wired — only the module screens will be added",
      ]}
    />
  );
}
