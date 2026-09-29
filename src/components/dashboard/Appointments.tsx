"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { DashboardAppointment } from "@/lib/dashboardTypes";
import {
  display,
  formatDateHeading,
  formatTime,
  statusBadgeClass,
  statusLabel,
} from "@/lib/dashboardFormat";

type AppointmentsProps = {
  /** Appointments scheduled for the server's current date. */
  todaysAppointments: DashboardAppointment[];
  /** Appointments strictly after today (never past dates), date ASC. */
  upcomingAppointments: DashboardAppointment[];
  /** True while the dashboard payload has not loaded yet. */
  loading?: boolean;
};

/** Upcoming input is already date ASC/time ASC, so adjacent dates group naturally. */
function groupByDate(items: DashboardAppointment[]): {
  date: string;
  items: DashboardAppointment[];
}[] {
  const groups: { date: string; items: DashboardAppointment[] }[] = [];
  for (const item of items) {
    const date = (item.appointmentDate ?? "").slice(0, 10);
    const key = date || "unknown";
    const last = groups[groups.length - 1];
    if (last && last.date === key) {
      last.items.push(item);
    } else {
      groups.push({ date: key, items: [item] });
    }
  }
  return groups;
}

function AppointmentRow({ appointment }: { appointment: DashboardAppointment }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="w-24 shrink-0">
        <p className="text-sm font-semibold text-slate-900">
          {formatTime(appointment.appointmentTime)}
        </p>
        <p className="mt-0.5 truncate text-[10px] tracking-tight text-[#5B6B7C]">
          {display(appointment.appointmentId)}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {display(appointment.patientName)}
        </p>
        <p className="truncate text-xs text-[#5B6B7C]">
          {display(appointment.doctorName)} · {display(appointment.clinicName)}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(
          appointment.status
        )}`}
      >
        {statusLabel(appointment.status)}
      </span>
    </div>
  );
}

function DateHeading({ children }: { children: string }) {
  return (
    <h3 className="mt-2 px-5 text-sm font-semibold text-slate-900">{children}</h3>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-sky-600">
      {children}
    </p>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-3 px-5 py-6">
      <div className="h-12 animate-pulse rounded-xl bg-[#E2E8F0]" />
      <div className="h-12 animate-pulse rounded-xl bg-[#E2E8F0]/70" />
      <div className="h-12 animate-pulse rounded-xl bg-[#E2E8F0]/50" />
    </div>
  );
}

export default function Appointments({
  todaysAppointments,
  upcomingAppointments,
  loading = false,
}: AppointmentsProps) {
  const upcomingGroups = groupByDate(upcomingAppointments);
  const hasToday = todaysAppointments.length > 0;
  const hasUpcoming = upcomingAppointments.length > 0;
  const isEmpty = !loading && !hasToday && !hasUpcoming;

  return (
    <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <CalendarDays size={18} className="text-sky-600" />
          <h2 className="text-sm font-semibold text-slate-900">Today&apos;s Appointments</h2>
        </div>
        <Link
          href="/dashboard/appointments"
          className="text-xs font-medium text-sky-600 hover:text-sky-700"
        >
          View all
        </Link>
      </div>

      {/* Loading — subtle skeleton, never fake appointments */}
      {loading && <SkeletonRows />}

      {/* Empty state — appointments will appear here once added */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/15 text-sky-600">
            <CalendarDays size={20} />
          </div>
          <p className="text-sm font-medium text-slate-900">No appointments yet</p>
          <p className="max-w-xs text-xs text-[#5B6B7C]">
            Appointments you add will show up here.
          </p>
        </div>
      )}

      {!loading && (hasToday || hasUpcoming) && (
        <div className="pb-4">
          {/* ---------- TODAY: list directly under the card header
              (no "TODAY" label / date heading) ---------- */}
          {hasToday && (
            <div className="divide-y divide-[#E2E8F0]">
              {todaysAppointments.map((appointment) => (
                <AppointmentRow key={appointment.id} appointment={appointment} />
              ))}
            </div>
          )}

          {/* ---------- UPCOMING (later dates only, one heading per date) ---------- */}
          {hasUpcoming && (
            <div>
              <SectionLabel>Upcoming</SectionLabel>
              {upcomingGroups.map((group) => (
                <div key={group.date}>
                  <DateHeading>{formatDateHeading(group.date)}</DateHeading>
                  <div className="mt-2 divide-y divide-[#E2E8F0] border-t border-[#E2E8F0]">
                    {group.items.map((appointment) => (
                      <AppointmentRow key={appointment.id} appointment={appointment} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
