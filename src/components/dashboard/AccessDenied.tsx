"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, RotateCcw } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import { useAuthMe } from "@/lib/useAuthMe";
import { firstAllowedRoute } from "@/lib/permissions";

/**
 * Clean Access Denied screen shown by the dashboard layout when the current
 * user's server-resolved permissions do not cover the requested route.
 * Keeps the existing sidebar/navbar shell so the user can still navigate to
 * the modules they ARE allowed to use. Sidebar visibility is cosmetic only —
 * the real boundary is requirePermission() on every API route.
 */
export default function AccessDenied({ permissions }: { permissions: string[] }) {
  const { me, loading, loadError, retry } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (loadError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load this page.</p>
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

  const businessName = me.business?.business_name ?? "My Clinic";

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <Sidebar
        user={{ name: me.user.name, businessName }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNavbar
          user={{ name: me.user.name }}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-lg rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
              <Lock size={26} />
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-900">Access Denied</h1>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              You don&apos;t have permission to view this page. If you believe
              you should have access, contact your administrator.
            </p>

            <div className="mt-6">
              <Link
                href={firstAllowedRoute(permissions)}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                Go to my dashboard
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
