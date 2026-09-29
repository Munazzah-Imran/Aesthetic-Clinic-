"use client";

import { FileImage } from "lucide-react";
import ModulePlaceholder from "@/components/dashboard/ModulePlaceholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="Uploaded Reports / Images"
      subtitle="Review patient-uploaded reports and medical images."
      icon={FileImage}
      bullets={[
        "Built on the same database and business isolation as the rest of the dashboard",
        "Navigation and theme are already wired — only the module screens will be added",
      ]}
    />
  );
}
