"use client";

import { useState } from "react";
import {
  Users,
  Stethoscope,
  CalendarDays,
  FileText,
  RotateCcw,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import StatCard from "@/components/dashboard/StatCard";
import Appointments from "@/components/dashboard/Appointments";
import RecentPatients from "@/components/dashboard/RecentPatients";
import DoctorsOverview from "@/components/dashboard/DoctorsOverview";
import { useAuthMe } from "@/lib/useAuthMe";
import { useDashboardData } from "@/lib/useDashboardData";

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { me, loading, loadError, retry } = useAuthMe();
  const {
    data: dashboard,
    loading: dashboardLoading,
    error: dashboardError,
    reload: reloadDashboard,
  } = useDashboardData();

  // ---------------- Loading state ----------------
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

  // ---------------- Error state ----------------
  if (loadError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">
            Unable to load clinic information.
          </p>
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

        <main className="flex-1 px-4 py-6 md:px-6 md:py-8">
          {/* Dashboard header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Welcome back, {me.user.name} 👋 Manage your clinic and keep track
                of today&apos;s activities.
              </p>
            </div>
            <span className="rounded-full border border-sky-600/30 bg-sky-500/10 px-3.5 py-1.5 text-sm font-semibold text-sky-600">
              {businessName}
            </span>
          </div>

          {/* Statistics cards — real counts from GET /api/dashboard (business-scoped).
              Skeleton while loading; "—" on error — hardcoded/fake 0s are never shown. */}
          {(() => {
            const statsLoading = dashboardLoading || (!dashboard && !dashboardError);
            const stat = (value: number | undefined) =>
              dashboard && value !== undefined ? String(value) : "—";
            return (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  icon={Users}
                  title="Total Patients"
                  value={stat(dashboard?.totalPatients)}
                  loading={statsLoading}
                />
                <StatCard
                  icon={Stethoscope}
                  title="Doctors"
                  value={stat(dashboard?.totalDoctors)}
                  loading={statsLoading}
                />
                <StatCard
                  icon={CalendarDays}
                  title="Appointments"
                  value={stat(dashboard?.totalAppointments)}
                  loading={statsLoading}
                />
                <StatCard
                  icon={FileText}
                  title="Pending Reports"
                  value={stat(dashboard?.pendingReports)}
                  trendUp={false}
                  loading={statsLoading}
                />
              </div>
            );
          })()}

          {dashboardError && !dashboard ? (
            /* ---------- Clean error state (layout/sidebar/navbar stay intact) ---------- */
            <div className="mt-6 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
              <p className="text-sm text-[#5B6B7C]">
                Unable to load dashboard data.
              </p>
              <button
                type="button"
                onClick={reloadDashboard}
                className="mx-auto mt-5 flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          ) : (
            <>
              {/* Appointments + Recent patients */}
              <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <Appointments
                  todaysAppointments={dashboard?.todayAppointments ?? []}
                  upcomingAppointments={dashboard?.upcomingAppointments ?? []}
                  loading={dashboardLoading || !dashboard}
                />
                <RecentPatients
                  patients={dashboard?.recentPatients ?? []}
                  loading={dashboardLoading || !dashboard}
                />
              </div>

              {/* Doctors overview */}
              <div className="mt-6">
                <DoctorsOverview
                  doctors={dashboard?.doctors ?? []}
                  loading={dashboardLoading || !dashboard}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
