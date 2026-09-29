"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Plus, RotateCcw, Search, Pencil, Trash2, Settings2, UserRound } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import DoctorForm, { EMPTY_DOCTOR_FORM, type DoctorFormValues } from "@/components/dashboard/DoctorForm";
import FormSelect from "@/components/dashboard/FormSelect";
import { useAuthMe } from "@/lib/useAuthMe";

type DoctorRecord = {
  id: string;
  fullName: string;
  specialty: string | null;
  professionalTitle: string | null;
  status: string;
  consultationDays: string | null;
  consultationStartTime: string | null;
  consultationEndTime: string | null;
  createdAt: string;
  updatedAt: string;
};

const PAGE_SIZE = 12;

const statusChip = (status: string) =>
  status === "active"
    ? "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30"
    : "bg-[#83909D]/15 text-[#83909D] border-[#83909D]/30";

function formatTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatTimestamp(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Compact "Mon–Fri · 10:00 AM–2:00 PM · 30 min · Max 5" summary for the card. */
function scheduleSummary(doctor: DoctorRecord): string | null {
  if (!doctor.consultationDays || !doctor.consultationStartTime || !doctor.consultationEndTime) {
    return null;
  }
  const days = doctor.consultationDays.split(",").filter(Boolean);
  const dayLabel =
    days.length === 7
      ? "Every day"
      : days.length === 5 &&
          days[0] === "Monday" &&
          days[1] === "Tuesday" &&
          days[2] === "Wednesday" &&
          days[3] === "Thursday" &&
          days[4] === "Friday"
        ? "Mon–Fri"
        : days.map((d) => d.slice(0, 3)).join(", ");
  return `${dayLabel} · ${formatTime(doctor.consultationStartTime)}–${formatTime(doctor.consultationEndTime)}`;
}

export default function DoctorsPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [doctors, setDoctors] = useState<DoctorRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // formKey: "add" | doctor id — remounts the form modal so every open starts
  // from a completely fresh state (no stale doctor data between opens).
  const [formKey, setFormKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<DoctorRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DoctorRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const loadDoctors = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/doctors");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: DoctorRecord[] | null;
        success: boolean;
      };
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        setDoctors([]);
        return;
      }
      setDoctors(result.data);
    } catch {
      setDoctors([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) loadDoctors();
  }, [authLoading, me, loadDoctors]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  function openAdd() {
    setEditing(null);
    setFormError(null);
    setFormKey("add"); // fresh mount -> EMPTY_DOCTOR_FORM
  }

  function openEdit(doctor: DoctorRecord) {
    setEditing(doctor);
    setFormError(null);
    setFormKey(doctor.id); // fresh mount -> this doctor's data only
  }

  function closeForm() {
    setFormKey(null);
    setEditing(null);
    setFormError(null);
  }

  async function handleSave(values: DoctorFormValues) {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const isEdit = formKey !== "add" && editing !== null;
      const url = isEdit && editing ? `/api/doctors/${editing.id}` : "/api/doctors";
      const response = await authFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: values.fullName,
          specialty: values.specialty,
          professionalTitle: values.professionalTitle,
          status: values.status,
          consultationDays: values.schedule.consultationDays,
          consultationStartTime: values.schedule.consultationStartTime,
          consultationEndTime: values.schedule.consultationEndTime,
        }),
      });
      const result = (await response.json()) as {
        data: { errors?: Record<string, string> } | null;
        success: boolean;
        message: string;
      };
      if (response.ok && result.success) {
        closeForm();
        showToast(isEdit ? "Doctor profile updated successfully." : "Doctor profile created successfully.");
        await loadDoctors();
      } else if (response.status === 400 && result.data && "errors" in result.data && result.data.errors) {
        setFormError(Object.values(result.data.errors)[0] ?? "Please check the form.");
      } else {
        setFormError(result.message ?? "Unable to save doctor.");
      }
    } catch {
      setFormError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await authFetch(`/api/doctors/${deleteTarget.id}`, { method: "DELETE" });
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        showToast("Doctor deleted successfully.");
        setDeleteTarget(null);
        await loadDoctors();
      } else {
        showToast(result.message ?? "Unable to delete doctor.");
      }
    } catch {
      showToast("Could not reach the server.");
    } finally {
      setDeleting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return doctors.filter((d) => {
      if (statusFilter !== "All" && d.status !== statusFilter.toLowerCase()) return false;
      if (!q) return true;
      return (
        d.fullName.toLowerCase().includes(q) ||
        (d.specialty ?? "").toLowerCase().includes(q) ||
        (d.professionalTitle ?? "").toLowerCase().includes(q)
      );
    });
  }, [doctors, search, statusFilter]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading doctors...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load doctor information.</p>
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
      <Sidebar user={{ name: me.user.name, businessName }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNavbar user={{ name: me.user.name }} onToggleSidebar={() => setSidebarOpen((v) => !v)} />

        <main className="flex-1 px-4 py-6 md:px-6 md:py-8">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Doctors Management</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Manage the doctors of your clinic — profiles, consultation schedules and availability.
              </p>
            </div>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600"
            >
              <Plus size={16} /> Add Doctor
            </button>
          </div>

          {/* Search + filter */}
          <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative w-full xl:max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#83909D]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doctors..."
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] py-2.5 pl-10 pr-4 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
              />
            </div>
            <div className="flex items-center gap-3">
              <FormSelect
                className="w-[170px]"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "All", label: "Status: All" },
                  { value: "Active", label: "Active" },
                  { value: "Inactive", label: "Inactive" },
                ]}
              />
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-44 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]" />
              ))}
            </div>
          ) : doctors.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <UserRound size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">No doctors added yet</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">Add your first doctor to get started.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <p className="text-sm font-medium text-slate-900">No doctors match your search.</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">Try a different name or clear the filters.</p>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.slice(0, visibleCount).map((d) => {
                const summary = scheduleSummary(d);
                return (
                  <div
                    key={d.id}
                    className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 transition-colors hover:border-[#0369A1]/40"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-600">
                        {initialsOf(d.fullName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900">{d.fullName}</p>
                        <p className="truncate text-sm text-[#5B6B7C]">{d.specialty ?? "—"}</p>
                      </div>
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusChip(
                          d.status
                        )}`}
                      >
                        {d.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2 border-t border-[#E2E8F0] pt-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-[#83909D]">Consultation</span>
                        <span className="text-right text-xs leading-5 text-[#5B6B7C]">{summary ?? "Not configured"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[#83909D]">Added</span>
                        <span className="text-[#5B6B7C]">{formatTimestamp(d.createdAt)}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2">
                      <Link
                        href={`/dashboard/doctors/${d.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-medium text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                      >
                        <Settings2 size={14} /> Full Profile
                      </Link>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(d)}
                          title="Edit doctor"
                          className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(d)}
                          title="Delete doctor"
                          className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-red-600 hover:text-red-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {visibleCount < filtered.length && !loading && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="rounded-xl border border-[#E2E8F0] px-5 py-2.5 text-sm font-medium text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
              >
                Show more
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Add/Edit modal — keyed by "add" or the doctor's id so every open is a
          completely fresh form (this is the stale-data fix). */}
      {formKey !== null && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
          onClick={closeForm}
        >
          <div
            key={formKey}
            className="my-8 w-full max-w-2xl rounded-3xl border border-[#E2E8F0] bg-[#F8FAFC] p-6 shadow-2xl sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900">
                {editing ? "Edit Doctor" : "Add Doctor"}
              </h2>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                {editing ? `Editing ${editing.fullName}` : "Add a new doctor to your clinic."}
              </p>
            </div>
            {formError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
                {formError}
              </div>
            )}
            <DoctorForm
              key={formKey}
              initial={
                editing
                  ? {
                      fullName: editing.fullName,
                      specialty: editing.specialty ?? "",
                      professionalTitle: editing.professionalTitle ?? "",
                      status: editing.status,
                      schedule: {
                        consultationDays: (editing.consultationDays ?? "")
                          .split(",")
                          .filter((d): d is (typeof EMPTY_DOCTOR_FORM.schedule.consultationDays)[number] =>
                            (["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const).includes(
                              d as (typeof EMPTY_DOCTOR_FORM.schedule.consultationDays)[number]
                            )
                          ),
                        consultationStartTime: editing.consultationStartTime ?? "",
                        consultationEndTime: editing.consultationEndTime ?? "",
                      },
                    }
                  : null
              }
              saving={saving}
              onSave={handleSave}
              onCancel={closeForm}
            />
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Delete Doctor</h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">Are you sure you want to delete this doctor?</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{deleteTarget.fullName}</p>
            <p className="mt-1 text-xs text-[#83909D]">
              Their appointments will also be removed. The detailed profile is kept for history.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete"}
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
