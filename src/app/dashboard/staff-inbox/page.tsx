"use client";

import { Inbox } from "lucide-react";
import ModulePlaceholder from "@/components/dashboard/ModulePlaceholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="Staff Inbox"
      subtitle="Staff messages and internal conversations live here."
      icon={Inbox}
      bullets={[
        "Built on the same database and business isolation as the rest of the dashboard",
        "Navigation and theme are already wired — only the module screens will be added",
      ]}
    />
  );
}
