"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import FormSelect from "@/components/dashboard/FormSelect";
import {
  mapApiAppointment,
  type AppointmentRecord,
} from "@/components/dashboard/AppointmentDetail";
import { useAuthMe } from "@/lib/useAuthMe";

/**
 * Calendar — monthly appointment overview.
 *
 * Counts come from the existing GET /api/appointments endpoint (PostgreSQL,
 * business-scoped by the JWT — no businessId is ever sent from the client).
 * Nothing is hardcoded and no second appointment system exists: clicking a
 * date simply opens the existing Appointments Management page with the
 * selected date in the URL (?date=YYYY-MM-DD), where the existing date
 * filter picks it up.
 */

const WEEKDAYS = [
  { full: "Sunday", short: "Sun" },
  { full: "Monday", short: "Mon" },
  { full: "Tuesday", short: "Tue" },
  { full: "Wednesday", short: "Wed" },
  { full: "Thursday", short: "Thu" },
  { full: "Friday", short: "Fri" },
  { full: "Saturday", short: "Sat" },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type DoctorOptionRaw = { id: string; full_name: string; specialty: string | null };
type ClinicOptionRaw = { id: string; clinic_name: string; city: string | null };

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoOf(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

export default function CalendarPage() {
  const router = useRouter();
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Visible month (local calendar month — no timezone shifting).
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsFailed, setCountsFailed] = useState(false);

  // Optional filters (real data from PostgreSQL — same endpoints the
  // Appointments page uses). The existing calendar had no filters; these
  // only narrow the counts shown, nothing is removed.
  const [doctors, setDoctors] = useState<DoctorOptionRaw[]>([]);
  const [clinics, setClinics] = useState<ClinicOptionRaw[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [clinicsLoading, setClinicsLoading] = useState(true);
  const [doctorFilter, setDoctorFilter] = useState("All");
  const [clinicFilter, setClinicFilter] = useState("All");

  const loadAppointments = useCallback(async () => {
    setCountsLoading(true);
    setCountsFailed(false);
    try {
      const response = await authFetch("/api/appointments");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: Record<string, unknown>[] | null;
        success: boolean;
      };
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        setAppointments([]);
        setCountsFailed(true);
        return;
      }
      setAppointments(result.data.map(mapApiAppointment));
    } catch {
      setAppointments([]);
      setCountsFailed(true);
    } finally {
      setCountsLoading(false);
    }
  }, [authFetch]);

  const loadFilterOptions = useCallback(() => {
    setDoctorsLoading(true);
    setClinicsLoading(true);
    authFetch("/api/doctors")
      .then(async (res) => (await res.json()) as { data: Record<string, unknown>[] | null })
      .then((json) => {
        setDoctors(
          (json.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            full_name: String(r.fullName ?? ""),
            specialty: typeof r.specialty === "string" ? (r.specialty as string) : null,
          }))
        );
      })
      .catch(() => setDoctors([]))
      .finally(() => setDoctorsLoading(false));
    authFetch("/api/clinics")
      .then(async (res) => (await res.json()) as { data: Record<string, unknown>[] | null })
      .then((json) => {
        setClinics(
          (json.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            clinic_name: String(r.clinic_name ?? ""),
            city: typeof r.city === "string" ? (r.city as string) : null,
          }))
        );
      })
      .catch(() => setClinics([]))
      .finally(() => setClinicsLoading(false));
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadAppointments();
      loadFilterOptions();
    }
  }, [authLoading, me, loadAppointments, loadFilterOptions]);

  // Appointment counts per ISO date, respecting the selected filters.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of appointments) {
      if (doctorFilter !== "All" && a.doctorId !== doctorFilter) continue;
      if (clinicFilter !== "All" && a.clinicId !== clinicFilter) continue;
      const iso = a.appointmentDate.slice(0, 10);
      if (!iso) continue;
      map.set(iso, (map.get(iso) ?? 0) + 1);
    }
    return map;
  }, [appointments, doctorFilter, clinicFilter]);

  // Month grid: correct weekday offset + correct day count (leap years are
  // handled by the Date constructor).
  const grid = useMemo(() => {
    const leading = new Date(view.year, view.month, 1).getDay();
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const cells: { day: number; iso: string }[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ day, iso: isoOf(view.year, view.month, day) });
    }
    return { leading, cells };
  }, [view]);

  const todayIso = useMemo(() => {
    const now = new Date();
    return isoOf(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  function goPrevious() {
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  }

  function goNext() {
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  }

  function goToday() {
    const now = new Date();
    setView({ year: now.getFullYear(), month: now.getMonth() });
  }

  /** Open the existing Appointments Management page filtered to this date. */
  function openDate(iso: string) {
    router.push(`/dashboard/appointments?date=${iso}`);
  }

  // ---------------- Auth loading / error (same shell as every dashboard page) ----------------
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading calendar...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load the calendar.</p>
          <button
            type="button"
            onClick={retryAuth}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
          >
            <RotateCcw size={16} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const businessName = me.business?.business_name ?? "My Clinic";
  const hasActiveFilters = doctorFilter !== "All" || clinicFilter !== "All";

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
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Monthly appointment overview. Dates with appointments are clickable — click one to open Appointments Management filtered to that date.
              </p>
            </div>
          </div>

          {/* Month navigation */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-2.5 shadow-sm md:px-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrevious}
                className="flex items-center gap-1 rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600"
              >
                <ChevronLeft size={16} />
                <span className="hidden sm:inline">Previous</span>
              </button>
              <h2 className="min-w-[150px] px-1 text-center text-base font-semibold text-slate-900 md:text-lg">
                {MONTHS[view.month]} {view.year}
              </h2>
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-1 rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              type="button"
              onClick={goToday}
              className="rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600"
            >
              Today
            </button>
          </div>

          {/* Filters — counts respect the selected doctor/clinic */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <FormSelect
              className="w-[190px] min-w-0 lg:w-[180px]"
              value={doctorFilter}
              onChange={setDoctorFilter}
              disabled={doctorsLoading}
              options={[
                { value: "All", label: "Doctor: All doctors" },
                ...doctors.map((d) => ({
                  value: d.id,
                  label: `Dr. ${d.full_name}`,
                  hint: d.specialty ?? undefined,
                })),
              ]}
            />
            <FormSelect
              className="w-[190px] min-w-0 lg:w-[176px]"
              value={clinicFilter}
              onChange={setClinicFilter}
              disabled={clinicsLoading}
              options={[
                { value: "All", label: "Clinic: All clinics" },
                ...clinics.map((c) => ({
                  value: c.id,
                  label: c.clinic_name,
                  hint: c.city ?? undefined,
                })),
              ]}
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setDoctorFilter("All");
                  setClinicFilter("All");
                }}
                className="shrink-0 rounded-xl border border-[#E2E8F0] px-3 py-2.5 text-sm text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Counts error — never show fake/incorrect numbers */}
          {countsFailed && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">
                Unable to load appointment counts. The dates below will not show numbers.
              </p>
              <button
                type="button"
                onClick={loadAppointments}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-[#FFFFFF] px-3 py-2 text-sm font-medium text-red-700 transition hover:border-red-400"
              >
                <RotateCcw size={14} /> Retry
              </button>
            </div>
          )}

          {/* Monthly grid */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-1 border-b border-[#E2E8F0] bg-[#EEF2F7] px-1 py-2.5 md:gap-2 md:px-3">
              {WEEKDAYS.map((w) => (
                <div
                  key={w.full}
                  className="text-center text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] md:text-[11px]"
                >
                  <span className="hidden md:inline">{w.full}</span>
                  <span className="md:hidden">{w.short}</span>
                </div>
              ))}
            </div>

            {/* Date cells */}
            <div className="grid grid-cols-7 gap-1 p-1 md:gap-2 md:p-3">
              {Array.from({ length: grid.leading }).map((_, i) => (
                <div
                  key={`blank-${i}`}
                  className="min-h-[64px] rounded-xl bg-[#F8FAFC] md:min-h-[104px]"
                  aria-hidden="true"
                />
              ))}

              {grid.cells.map((cell) => {
                const count = counts.get(cell.iso);
                const isToday = cell.iso === todayIso;

                // Only dates that actually have appointments are clickable;
                // every other card is a plain (non-clickable) card until the
                // counts are known. The card itself renders for every date.
                const clickable = !countsLoading && !countsFailed && !!count;

                // Theme fill: dates WITH appointments get the sky accent
                // tint; dates without keep the plain white card.
                const filled = clickable;

                const statusText = countsLoading
                  ? "loading appointment count"
                  : countsFailed
                    ? "appointment count unavailable"
                    : count
                      ? `${count} appointment${count === 1 ? "" : "s"}`
                      : "no appointments";

                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={!clickable}
                    onClick={() => openDate(cell.iso)}
                    aria-label={`${MONTHS[view.month]} ${cell.day}, ${view.year} — ${statusText}${
                      clickable ? ". Open appointments for this date." : "."
                    }`}
                    className={`flex min-h-[64px] flex-col items-start gap-1 rounded-xl border p-1.5 text-left md:min-h-[104px] md:gap-1.5 md:p-2.5 ${
                      filled ? "bg-sky-500/10" : "bg-[#FFFFFF]"
                    } ${
                      isToday
                        ? "border-sky-500 ring-1 ring-sky-500/40"
                        : filled
                          ? "border-sky-500/50"
                          : "border-[#E2E8F0]"
                    } ${
                      clickable
                        ? `cursor-pointer transition ${
                            filled
                              ? "hover:border-sky-600 hover:bg-sky-500/20"
                              : "hover:border-sky-500/60 hover:bg-sky-500/5"
                          }`
                        : "cursor-default"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-semibold md:h-6 md:w-6 md:text-xs ${
                        isToday ? "bg-sky-500 text-slate-900" : "text-[#1E293B]"
                      }`}
                    >
                      {cell.day}
                    </span>

                    {countsLoading ? (
                      <span
                        className="block h-3 w-10 animate-pulse rounded-full bg-[#E2E8F0] md:h-3.5 md:w-14"
                        aria-hidden="true"
                      />
                    ) : countsFailed ? (
                      <span className="text-[10px] leading-tight text-[#83909D] md:text-xs">—</span>
                    ) : count ? (
                      <span className="text-[10px] leading-tight text-[#5B6B7C] md:text-xs">
                        <span className="font-semibold text-sky-700">{count}</span>{" "}
                        <span className="hidden sm:inline">
                          {count === 1 ? "appointment" : "appointments"}
                        </span>
                        <span className="sm:hidden">appt{count === 1 ? "" : "s"}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] leading-tight text-[#83909D] md:text-xs">
                        <span className="hidden sm:inline">No appointments</span>
                        <span className="sm:hidden">0 appts</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
