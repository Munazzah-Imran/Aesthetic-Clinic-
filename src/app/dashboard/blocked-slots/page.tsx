"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import {
  STATUS_LABELS,
  STATUS_STYLES,
} from "@/components/dashboard/ClinicCard";
import { useAuthMe } from "@/lib/useAuthMe";
import {
  formatOffDate,
  isPastOffDate,
} from "@/lib/offDays";
import { formatScheduleTime } from "@/lib/weeklySchedule";
import type { ClinicBlockedSlot, ClinicBlockedSlotsItem } from "@/lib/blockedSlots";

type FieldErrors = Partial<
  Record<"clinicId" | "blockDate" | "startTime" | "endTime" | "reason", string>
>;
type DeleteTarget = { item: ClinicBlockedSlotsItem; slot: ClinicBlockedSlot } | null;

/**
 * Blocked Slots — one list of blocked time ranges per clinic, loaded from
 * the existing `clinic` table through GET /api/blocked-slots. Appointments
 * whose start time falls inside a range on that date are rejected by the
 * Appointments API.
 */
export default function BlockedSlotsPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [items, setItems] = useState<ClinicBlockedSlotsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [addFor, setAddFor] = useState<ClinicBlockedSlotsItem | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formReason, setFormReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadBlockedSlots = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/blocked-slots");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: ClinicBlockedSlotsItem[] | null;
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
      loadBlockedSlots();
    }
  }, [authLoading, me, loadBlockedSlots]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  function openAdd(item: ClinicBlockedSlotsItem) {
    setAddFor(item);
    setFormDate("");
    setFormStart("");
    setFormEnd("");
    setFormReason("");
    setFieldErrors({});
    setSubmitError(null);
  }

  /** Block one time range for the selected clinic (identified by its UUID). */
  async function submitBlockedSlot() {
    if (!addFor || saving) return;
    setSaving(true);
    setFieldErrors({});
    setSubmitError(null);
    try {
      const response = await authFetch("/api/blocked-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId: addFor.clinic.id,
          blockDate: formDate,
          startTime: formStart,
          endTime: formEnd,
          reason: formReason,
        }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: { errors?: FieldErrors } | null;
        error: string | null;
        success: boolean;
        message: string;
      };

      if (response.ok && result.success) {
        setAddFor(null);
        await loadBlockedSlots();
        showToast("Blocked slot added.");
        return;
      }

      if (
        (response.status === 400 || response.status === 409) &&
        result.data &&
        typeof result.data === "object" &&
        "errors" in result.data &&
        result.data.errors
      ) {
        setFieldErrors(result.data.errors);
        setSubmitError(result.message ?? "Please fix the highlighted fields.");
        return;
      }

      setSubmitError(result.message ?? result.error ?? "Unable to add blocked slot.");
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await authFetch(`/api/blocked-slots/${deleteTarget.slot.id}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        setDeleteTarget(null);
        await loadBlockedSlots();
        showToast("Blocked slot removed.");
      } else {
        showToast(result.message ?? "Unable to remove blocked slot.");
      }
    } catch {
      showToast("Could not reach the server.");
    } finally {
      setDeleting(false);
    }
  }

  // ---------------- Auth loading / error ----------------
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading blocked slots...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load blocked slots.</p>
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
              <h1 className="text-2xl font-bold text-slate-900">Blocked Slots</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Block specific time slots so they cannot be booked.
              </p>
            </div>
            <Link
              href="/dashboard/weekly-schedule"
              className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:border-sky-500/50 hover:text-sky-600"
            >
              <Clock size={16} /> Weekly Schedule
            </Link>
          </div>

          {/* Content */}
          {loading ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-56 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <Ban size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                No clinics added yet.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Add a clinic from the Clinics section to block its time slots.
              </p>
              <Link
                href="/dashboard/clinics"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <Building2 size={16} /> Go to Clinics
              </Link>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {items.map((item) => (
                <div
                  key={item.clinic.id}
                  className="flex flex-col rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 transition-colors hover:border-sky-500/40"
                >
                  {/* Clinic header: Name, City + status (live from clinic table) */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600">
                        <Ban size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">
                            {item.clinic.clinic_name}, {item.clinic.city}
                          </h3>
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
                        <p className="text-xs text-[#5B6B7C]">Blocked time ranges</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAdd(item)}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-600"
                    >
                      <Plus size={13} /> Block Slot
                    </button>
                  </div>

                  {/* Blocked-slot list */}
                  <div className="mt-4 border-t border-[#E2E8F0]">
                    {item.slots.length === 0 ? (
                      <p className="py-6 text-center text-sm text-[#83909D]">
                        No blocked slots for this clinic.
                      </p>
                    ) : (
                      item.slots.map((slot) => {
                        const past = isPastOffDate(slot.block_date);
                        return (
                          <div
                            key={slot.id}
                            className="flex items-center justify-between gap-3 border-b border-[#F1F5F9] py-2.5 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p
                                className={`text-sm font-medium ${
                                  past ? "text-[#83909D]" : "text-slate-900"
                                }`}
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <CalendarClock size={13} className="text-sky-600" />
                                  {formatOffDate(slot.block_date)}
                                </span>
                                <span className="ml-2 whitespace-nowrap">
                                  {formatScheduleTime(slot.start_time)} –{" "}
                                  {formatScheduleTime(slot.end_time)}
                                </span>
                                {past && (
                                  <span className="ml-2 text-[10px] font-bold tracking-wide text-[#83909D]">
                                    PAST
                                  </span>
                                )}
                              </p>
                              {slot.reason && (
                                <p className="truncate text-xs text-[#5B6B7C]">
                                  {slot.reason}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget({ item, slot })}
                              aria-label="Remove blocked slot"
                              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-1.5 text-xs font-semibold text-[#5B6B7C] transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600"
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Add blocked-slot modal — scoped to one clinic by UUID */}
      {addFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Block Slot</h3>
            <p className="mt-1 text-sm text-[#5B6B7C]">
              {addFor.clinic.clinic_name}, {addFor.clinic.city}
            </p>

            {submitError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {submitError}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="blocked-slot-date"
                  className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                >
                  Date <span className="ml-1 text-sky-600">*</span>
                </label>
                <input
                  id="blocked-slot-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                    fieldErrors.blockDate ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {fieldErrors.blockDate && (
                  <p className="text-xs text-red-600">{fieldErrors.blockDate}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="blocked-slot-start"
                    className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                  >
                    From <span className="ml-1 text-sky-600">*</span>
                  </label>
                  <input
                    id="blocked-slot-start"
                    type="time"
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                    className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                      fieldErrors.startTime ? "border-red-400/70" : "border-[#E2E8F0]"
                    }`}
                  />
                  {fieldErrors.startTime && (
                    <p className="text-xs text-red-600">{fieldErrors.startTime}</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="blocked-slot-end"
                    className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                  >
                    To <span className="ml-1 text-sky-600">*</span>
                  </label>
                  <input
                    id="blocked-slot-end"
                    type="time"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                      fieldErrors.endTime ? "border-red-400/70" : "border-[#E2E8F0]"
                    }`}
                  />
                  {fieldErrors.endTime && (
                    <p className="text-xs text-red-600">{fieldErrors.endTime}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="blocked-slot-reason"
                  className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                >
                  Reason <span className="text-[#83909D]">(optional)</span>
                </label>
                <input
                  id="blocked-slot-reason"
                  type="text"
                  maxLength={255}
                  placeholder="e.g. Lunch break"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-[#83909D] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                    fieldErrors.reason ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {fieldErrors.reason && (
                  <p className="text-xs text-red-600">{fieldErrors.reason}</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setAddFor(null)}
                disabled={saving}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitBlockedSlot}
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Block Slot"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Delete Blocked Slot</h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              Are you sure you want to unblock this time range?
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {formatOffDate(deleteTarget.slot.block_date)} —{" "}
              {formatScheduleTime(deleteTarget.slot.start_time)} to{" "}
              {formatScheduleTime(deleteTarget.slot.end_time)}
            </p>
            <p className="mt-0.5 text-xs text-[#5B6B7C]">
              {deleteTarget.item.clinic.clinic_name},{" "}
              {deleteTarget.item.clinic.city}
              {deleteTarget.slot.reason ? ` — ${deleteTarget.slot.reason}` : ""}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-60"
              >
                {deleting ? "Removing..." : "Delete"}
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
