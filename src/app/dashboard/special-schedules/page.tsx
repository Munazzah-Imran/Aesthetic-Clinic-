"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  Clock3,
  Pencil,
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
import { formatScheduleTime } from "@/lib/weeklySchedule";
import {
  formatOffDate as formatDate,
  isPastOffDate as isPastDate,
} from "@/lib/offDays";
import {
  type ClinicSpecialSchedule,
  type ClinicSpecialsItem,
  type SpecialFieldErrors,
} from "@/lib/specialSchedules";

type FormTarget = {
  item: ClinicSpecialsItem;
  special?: ClinicSpecialSchedule; // present = edit mode
} | null;
type DeleteTarget = { item: ClinicSpecialsItem; special: ClinicSpecialSchedule } | null;

/**
 * Special Schedules — the one-off OVERRIDE counterpart of the Weekly
 * Schedule: on a specific date a clinic opens with different hours than
 * its recurring weekly pattern. Loaded from the existing `clinic` table
 * through GET /api/special-schedules; each entry is edited/deleted by its
 * own UUID, so changes only ever affect that one clinic entry.
 */
export default function SpecialSchedulesPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [items, setItems] = useState<ClinicSpecialsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [formFor, setFormFor] = useState<FormTarget>(null);
  const [formDate, setFormDate] = useState("");
  const [formOpen, setFormOpen] = useState("");
  const [formClose, setFormClose] = useState("");
  const [formReason, setFormReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SpecialFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadSpecials = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/special-schedules");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: ClinicSpecialsItem[] | null;
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
      loadSpecials();
    }
  }, [authLoading, me, loadSpecials]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  function openForm(target: NonNullable<FormTarget>) {
    const special = target.special;
    setFormFor(target);
    setFormDate(special?.special_date ?? "");
    setFormOpen(special?.opening_time ?? "");
    setFormClose(special?.closing_time ?? "");
    setFormReason(special?.reason ?? "");
    setFieldErrors({});
    setSubmitError(null);
  }

  /** Create (POST) or update (PATCH) — always scoped to one clinic by UUID. */
  async function submitForm() {
    if (!formFor || saving) return;
    setSaving(true);
    setFieldErrors({});
    setSubmitError(null);
    try {
      const editing = formFor.special;
      const response = await authFetch(
        editing
          ? `/api/special-schedules/${editing.id}`
          : "/api/special-schedules",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinicId: formFor.item.clinic.id,
            specialDate: formDate,
            openingTime: formOpen,
            closingTime: formClose,
            reason: formReason,
          }),
        }
      );
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: { errors?: SpecialFieldErrors } | null;
        error: string | null;
        success: boolean;
        message: string;
      };

      if (response.ok && result.success) {
        setFormFor(null);
        await loadSpecials();
        showToast(editing ? "Special schedule updated." : "Special schedule added.");
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

      setSubmitError(result.message ?? result.error ?? "Unable to save special schedule.");
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
      const response = await authFetch(
        `/api/special-schedules/${deleteTarget.special.id}`,
        { method: "DELETE" }
      );
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        setDeleteTarget(null);
        await loadSpecials();
        showToast("Special schedule removed.");
      } else {
        showToast(result.message ?? "Unable to remove special schedule.");
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
          <p className="text-sm text-[#5B6B7C]">Loading special schedules...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load special schedules.</p>
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
              <h1 className="text-2xl font-bold text-slate-900">Special Schedules</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Define one-off schedule overrides for special days.
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
                <Clock3 size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                No clinics added yet.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Add a clinic from the Clinics section to define its special hours.
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
                        <Clock3 size={18} />
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
                        <p className="text-xs text-[#5B6B7C]">One-off hours</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openForm({ item })}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-600"
                    >
                      <Plus size={13} /> Add
                    </button>
                  </div>

                  {/* Override list */}
                  <div className="mt-4 border-t border-[#E2E8F0]">
                    {item.specials.length === 0 ? (
                      <p className="py-6 text-center text-sm text-[#83909D]">
                        No special schedules for this clinic.
                      </p>
                    ) : (
                      item.specials.map((special) => {
                        const past = isPastDate(special.special_date);
                        return (
                          <div
                            key={special.id}
                            className="flex items-center justify-between gap-3 border-b border-[#F1F5F9] py-2.5 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p
                                className={`text-sm font-medium ${
                                  past ? "text-[#83909D]" : "text-slate-900"
                                }`}
                              >
                                {formatDate(special.special_date)}
                                {past && (
                                  <span className="ml-2 text-[10px] font-bold tracking-wide text-[#83909D]">
                                    PAST
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-xs text-[#5B6B7C]">
                                {special.reason ?? "Special hours"}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="rounded-md bg-sky-500/15 px-2 py-1 text-xs font-semibold text-sky-600">
                                {formatScheduleTime(special.opening_time)} –{" "}
                                {formatScheduleTime(special.closing_time)}
                              </span>
                              <button
                                type="button"
                                onClick={() => openForm({ item, special })}
                                aria-label="Edit special schedule"
                                className="flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-2 py-1.5 text-xs font-semibold text-[#5B6B7C] transition-colors hover:border-sky-500/40 hover:text-sky-600"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({ item, special })}
                                aria-label="Delete special schedule"
                                className="flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-2 py-1.5 text-xs font-semibold text-[#5B6B7C] transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
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

      {/* Add / edit modal — scoped to one clinic by UUID */}
      {formFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">
              {formFor.special ? "Edit Special Schedule" : "Add Special Schedule"}
            </h3>
            <p className="mt-1 text-sm text-[#5B6B7C]">
              {formFor.item.clinic.clinic_name}, {formFor.item.clinic.city}
            </p>

            {submitError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {submitError}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="special-date"
                  className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                >
                  Date <span className="ml-1 text-sky-600">*</span>
                </label>
                <input
                  id="special-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                    fieldErrors.specialDate ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {fieldErrors.specialDate && (
                  <p className="text-xs text-red-600">{fieldErrors.specialDate}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="special-open"
                    className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                  >
                    Opening <span className="ml-1 text-sky-600">*</span>
                  </label>
                  <input
                    id="special-open"
                    type="time"
                    value={formOpen}
                    onChange={(e) => setFormOpen(e.target.value)}
                    className={`w-full rounded-xl border bg-[#F1F5F9] px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                      fieldErrors.openingTime ? "border-red-400/70" : "border-[#E2E8F0]"
                    }`}
                  />
                  {fieldErrors.openingTime && (
                    <p className="text-xs text-red-600">{fieldErrors.openingTime}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="special-close"
                    className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                  >
                    Closing <span className="ml-1 text-sky-600">*</span>
                  </label>
                  <input
                    id="special-close"
                    type="time"
                    value={formClose}
                    onChange={(e) => setFormClose(e.target.value)}
                    className={`w-full rounded-xl border bg-[#F1F5F9] px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                      fieldErrors.closingTime ? "border-red-400/70" : "border-[#E2E8F0]"
                    }`}
                  />
                  {fieldErrors.closingTime && (
                    <p className="text-xs text-red-600">{fieldErrors.closingTime}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="special-reason"
                  className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                >
                  Reason <span className="text-[#83909D]">(optional)</span>
                </label>
                <input
                  id="special-reason"
                  type="text"
                  maxLength={255}
                  placeholder="e.g. Holiday eve"
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
                onClick={() => setFormFor(null)}
                disabled={saving}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitForm}
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : formFor.special
                    ? "Save Changes"
                    : "Add Special Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">
              Delete Special Schedule
            </h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              Are you sure you want to remove this override?
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {formatDate(deleteTarget.special.special_date)} —{" "}
              {formatScheduleTime(deleteTarget.special.opening_time)} –{" "}
              {formatScheduleTime(deleteTarget.special.closing_time)}
            </p>
            <p className="mt-0.5 text-xs text-[#5B6B7C]">
              {deleteTarget.item.clinic.clinic_name},{" "}
              {deleteTarget.item.clinic.city}
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
