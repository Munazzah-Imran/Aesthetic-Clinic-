"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import AccessDenied from "@/components/dashboard/AccessDenied";
import FirstLoginPassword from "@/components/dashboard/FirstLoginPassword";
import { isPathAllowed } from "@/lib/permissions";
import { usePermissions } from "@/lib/usePermissions";

/**
 * Route-level permission gate for EVERY /dashboard page (layer 2/3 of the
 * RBAC enforcement).
 *
 * The permissions checked here are resolved SERVER-SIDE from PostgreSQL
 * (GET /api/auth/permissions) — editing React state or the URL cannot grant
 * anything, and every API call those pages make is independently guarded by
 * requirePermission() (layer 4/5). This layout simply keeps unauthorized
 * modules from ever mounting (no data is fetched for them) and shows a clean
 * Access Denied screen instead.
 *
 * It also enforces the forced first-login password change for staff accounts
 * before any module renders.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, loading, error, unauthenticated, retry, refresh } = usePermissions();

  // No/invalid token or a deactivated account -> back to the login screen.
  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);

  if (loading || unauthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load your permissions.</p>
          <button
            type="button"
            onClick={retry}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
          >
            <RotateCcw size={16} /> Retry
          </button>
        </div>
      </div>
    );
  }

  // Forced first-login password change (staff with must_change_password).
  if (data.mustChangePassword) {
    return <FirstLoginPassword onDone={() => void refresh()} />;
  }

  // Page gate: only modules the server granted may render at all.
  if (!isPathAllowed(pathname, data.permissions)) {
    return <AccessDenied permissions={data.permissions} />;
  }

  return <>{children}</>;
}
