"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import type { DashboardPatient } from "@/lib/dashboardTypes";
import { formatShortDate, initialsOf } from "@/lib/dashboardFormat";

type RecentPatientsProps = {
  patients: DashboardPatient[];
  /** True while the dashboard payload has not loaded yet. */
  loading?: boolean;
};

function SkeletonRow({ index }: { index: number }) {
  return (
    <div
      className="flex animate-pulse items-center gap-3 px-5 py-3.5"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="h-9 w-9 shrink-0 rounded-full bg-[#E2E8F0]" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/2 rounded bg-[#E2E8F0]" />
        <div className="h-3 w-1/3 rounded bg-[#E2E8F0]/70" />
      </div>
      <div className="h-3 w-16 rounded bg-[#E2E8F0]/70" />
    </div>
  );
}

export default function RecentPatients({ patients, loading = false }: RecentPatientsProps) {
  const isEmpty = !loading && patients.length === 0;

  return (
    <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Users size={18} className="text-sky-600" />
          <h2 className="text-sm font-semibold text-slate-900">Recent Patients</h2>
        </div>
        <Link
          href="/dashboard/patients"
          className="text-xs font-medium text-sky-600 hover:text-sky-700"
        >
          View all
        </Link>
      </div>

      {/* Loading — subtle skeleton, never fake numbers or names */}
      {loading && (
        <div className="divide-y divide-[#E2E8F0]">
          <SkeletonRow index={0} />
          <SkeletonRow index={1} />
          <SkeletonRow index={2} />
        </div>
      )}

      {/* Empty state — patients will appear here once added */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/15 text-sky-600">
            <Users size={20} />
          </div>
          <p className="text-sm font-medium text-slate-900">No patients yet</p>
          <p className="max-w-xs text-xs text-[#5B6B7C]">
            Patients you add will show up here.
          </p>
        </div>
      )}

      {/* Latest patients — newest first (created_at DESC, limited to 5) */}
      {!loading && patients.length > 0 && (
        <div className="divide-y divide-[#E2E8F0]">
          {patients.map((patient) => (
            <div key={patient.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-xs font-semibold text-sky-600">
                {initialsOf(patient.fullName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {patient.fullName || "—"}
                </p>
                <p className="truncate text-xs text-[#5B6B7C]">
                  {patient.patientId || "—"}
                </p>
              </div>
              <span className="shrink-0 text-xs text-[#5B6B7C]">
                {formatShortDate(patient.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
