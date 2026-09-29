"use client";

import { ClipboardList } from "lucide-react";
import ModulePlaceholder from "@/components/dashboard/ModulePlaceholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="Audit Logs"
      subtitle="Track important actions across your clinic workspace."
      icon={ClipboardList}
      bullets={[
        "Built on the same database and business isolation as the rest of the dashboard",
        "Navigation and theme are already wired — only the module screens will be added",
      ]}
    />
  );
}
