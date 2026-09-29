"use client";

import { UsersRound } from "lucide-react";
import ModulePlaceholder from "@/components/dashboard/ModulePlaceholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="Staff"
      subtitle="Manage clinic staff members and their access."
      icon={UsersRound}
      bullets={[
        "Built on the same database and business isolation as the rest of the dashboard",
        "Navigation and theme are already wired — only the module screens will be added",
      ]}
    />
  );
}
