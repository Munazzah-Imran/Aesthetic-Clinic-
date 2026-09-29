"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Construction, RotateCcw } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import { useAuthMe } from "@/lib/useAuthMe";

type ModulePlaceholderProps = {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  bullets: string[];
};

/**
 * Clean "coming soon" shell for future modules. Uses the same dashboard
 * layout/theme; contains no fake data and no fake functionality.
 */
export default function ModulePlaceholder({ title, subtitle, icon: Icon, bullets }: ModulePlaceholderProps) {
  const { me, loading, loadError, retry } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
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
      <Sidebar user={{ name: me.user.name, businessName }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNavbar user={{ name: me.user.name }} onToggleSidebar={() => setSidebarOpen((v) => !v)} />

        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-lg rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
              <Icon size={26} />
            </div>
            <h1 className="mt-4 text-xl font-bold text-slate-900">{title}</h1>
            <p className="mt-2 text-sm text-[#5B6B7C]">{subtitle}</p>

            <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left">
              {bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2 text-sm text-[#5B6B7C]">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500/70" />
                  {bullet}
                </li>
              ))}
            </ul>

            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-[#F1F5F9] px-3 py-1.5 text-xs text-[#83909D]">
              <Construction size={13} /> This module is coming soon
            </p>

            <div className="mt-6">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] px-4 py-2.5 text-sm font-medium text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600"
              >
                <ArrowLeft size={14} /> Back to Overview
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
