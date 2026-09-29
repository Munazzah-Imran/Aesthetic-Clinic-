"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Pencil,
  RotateCcw,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import {
  STATUS_LABELS,
  STATUS_STYLES,
} from "@/components/dashboard/ClinicCard";
import { useAuthMe } from "@/lib/useAuthMe";
import {
  formatScheduleTime,
  type WeeklyClinicSchedule,
  type WeeklyScheduleDay,
} from "@/lib/weeklySchedule";

/**
 * Weekly Schedule — one independent Monday→Sunday schedule per clinic.
 *
 * Everything is loaded dynamically from the existing `clinic` table through
 * GET /api/weekly-schedule: clinic name, city and every day's hours. Nothing
 * is hardcoded. The edit form PATCHes a single clinic by its UUID, so
 * changes can never affect another clinic.
 */
export default function WeeklySchedulePage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [items, setItems] = useState<WeeklyClinicSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<WeeklyClinicSchedule | null>(null);
  const [draft, setDraft] = useState<WeeklyScheduleDay[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/weekly-schedule");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: WeeklyClinicSchedule[] | null;
        success: boolean;
      };
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        setItems([]);
        return;
      }
      setItems(result.data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadSchedule();
    }
  }, [authLoading, me, loadSchedule]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  function openEdit(item: WeeklyClinicSchedule) {
    setEditing(item);
    setDraft(item.schedule.map((day) => ({ ...day })));
    setFormError(null);
  }

  function updateDay(index: number, patch: Partial<WeeklyScheduleDay>) {
    setDraft((prev) =>
      prev.map((day, i) => (i === index ? { ...day, ...patch } : day))
    );
  }

  /** PATCH only the selected clinic — identified by its unique UUID. */
  async function saveSchedule() {
    if (!editing || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const response = await authFetch(
        `/api/weekly-schedule/${editing.clinic.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            days: draft.map((day) => ({
              day: day.day,
              isOpen: day.is_open,
              openingTime: day.opening_time,
              closingTime: day.closing_time,
            })),
          }),
        }
      );
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: WeeklyClinicSchedule | null;
        error: string | null;
        success: boolean;
        message: string;
      };
      if (response.ok && result.success && result.data) {
        const updated = result.data;
        setItems((prev) =>
          prev.map((item) =>
            item.clinic.id === updated.clinic.id ? updated : item
          )
        );
        setEditing(null);
        showToast("Weekly schedule updated.");
        return;
      }
      setFormError(result.message ?? result.error ?? "Unable to save schedule.");
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---------------- Auth loading / error ----------------
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading weekly schedule...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load the weekly schedule.</p>
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
              <h1 className="text-2xl font-bold text-slate-900">Weekly Schedule</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Set each clinic&apos;s Monday–Sunday opening hours and availability.
              </p>
            </div>
            <Link
              href="/dashboard/clinics"
              className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:border-sky-500/50 hover:text-sky-600"
            >
              <Building2 size={16} /> Manage Clinics
            </Link>
          </div>

          {/* Content */}
          {loading ? (
            <div className="mt-6 space-y-4">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-80 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <CalendarClock size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                No clinics added yet.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Add a clinic from the Clinics section to configure its weekly schedule.
              </p>
              <Link
                href="/dashboard/clinics"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <Building2 size={16} /> Go to Clinics
              </Link>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {items.map((item) => (
                <div
                  key={item.clinic.id}
                  className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 transition-colors hover:border-sky-500/40"
                >
                  {/* Clinic header: Name, City (read live from the clinic table) */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600">
                        <CalendarClock size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">
                            {item.clinic.clinic_name}, {item.clinic.city}
                          </h3>
                          {/* Clinic status — read live from the clinic table */}
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${
                              STATUS_STYLES[item.clinic.status] ??
                              STATUS_STYLES.inactive
                            }`}
                          >
                            {STATUS_LABELS[item.clinic.status] ??
                              item.clinic.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-[#5B6B7C]">Weekly availability</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-600"
                    >
                      <Pencil size={13} /> Edit Schedule
                    </button>
                  </div>

                  {/* Monday → Sunday */}
                  <div className="mt-4 border-t border-[#E2E8F0]">
                    {item.schedule.map((day) => (
                      <div
                        key={day.day}
                        className="flex items-center justify-between gap-3 border-b border-[#F1F5F9] py-2.5 last:border-b-0"
                      >
                        <span className="w-32 shrink-0 text-sm font-medium text-slate-900">
                          {day.day}
                        </span>
                        {day.is_open ? (
                          <span className="flex min-w-0 items-center gap-2 text-sm text-[#5B6B7C]">
                            <span className="truncate">
                              {formatScheduleTime(day.opening_time)} –{" "}
                              {formatScheduleTime(day.closing_time)}
                            </span>
                            <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-sky-600">
                              ACTIVE
                            </span>
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#83909D]">
                            CLOSED
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Edit schedule modal — scoped to one clinic by UUID */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Edit Schedule</h3>
            <p className="mt-1 text-sm text-[#5B6B7C]">
              {editing.clinic.clinic_name}, {editing.clinic.city}
            </p>

            {formError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {formError}
              </p>
            )}

            <div className="mt-4 max-h-[52vh] space-y-3 overflow-y-auto pr-1">
              {draft.map((day, index) => (
                <div
                  key={day.day}
                  className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {day.day}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateDay(index, { is_open: !day.is_open })}
                      aria-pressed={day.is_open}
                      className={`rounded-full border px-3 py-1 text-[11px] font-bold tracking-wide transition-colors ${
                        day.is_open
                          ? "border-sky-600/30 bg-sky-500/15 text-sky-600"
                          : "border-[#E2E8F0] bg-[#E2E8F0] text-[#5B6B7C]"
                      }`}
                    >
                      {day.is_open ? "Active" : "Closed"}
                    </button>
                  </div>

                  {day.is_open && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <input
                        type="time"
                        value={day.opening_time ?? ""}
                        onChange={(e) =>
                          updateDay(index, { opening_time: e.target.value || null })
                        }
                        aria-label={`${day.day} opening time`}
                        className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-2.5 py-1.5 text-sm text-slate-900 outline-none transition-colors focus:border-sky-500"
                      />
                      <span className="text-xs text-[#83909D]">to</span>
                      <input
                        type="time"
                        value={day.closing_time ?? ""}
                        onChange={(e) =>
                          updateDay(index, { closing_time: e.target.value || null })
                        }
                        aria-label={`${day.day} closing time`}
                        className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-2.5 py-1.5 text-sm text-slate-900 outline-none transition-colors focus:border-sky-500"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSchedule}
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-sky-600/30 bg-[#FFFFFF] px-4 py-3 shadow-xl">
          <CheckCircle2 size={18} className="text-sky-600" />
          <p className="text-sm font-medium text-slate-900">{toast}</p>
        </div>
      )}
    </div>
  );
}
