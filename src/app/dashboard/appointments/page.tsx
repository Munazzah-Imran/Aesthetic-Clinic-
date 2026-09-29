"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Plus,
  RotateCcw,
  CheckCircle2,
  Search,
  Pencil,
  Trash2,
  Eye,
  XCircle,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import AppointmentDetail, {
  mapApiAppointment,
  type AppointmentRecord,
} from "@/components/dashboard/AppointmentDetail";
import AppointmentForm from "@/components/dashboard/AppointmentForm";
import FormSelect from "@/components/dashboard/FormSelect";
import { useAuthMe } from "@/lib/useAuthMe";
import { APPOINTMENT_STATUS_LABELS } from "@/lib/appointmentValidation";

const STATUS_FILTERS = ["All", "Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"];
const TYPE_FILTERS = ["All", "Consultation", "Follow-up", "Check-up", "Procedure", "Other"];

type PatientOptionRaw = { id: string; patient_id: string; full_name: string };
type DoctorOptionRaw = { id: string; full_name: string; specialty: string | null };
type ClinicOptionRaw = { id: string; clinic_name: string; city: string | null };

const statusChip = (status: string) => {
  const s = status.toLowerCase();
  if (s === "scheduled") return "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30";
  if (s === "confirmed") return "bg-sky-500/15 text-sky-700 border-sky-600/30";
  if (s === "completed") return "bg-sky-600/15 text-sky-700 border-sky-600/30";
  if (s === "cancelled") return "bg-red-500/15 text-red-700 border-red-500/30";
  return "bg-amber-500/15 text-amber-700 border-amber-500/30";
};

const statusLabel = (status: string) => {
  const s = status.toLowerCase();
  return APPOINTMENT_STATUS_LABELS[s as keyof typeof APPOINTMENT_STATUS_LABELS] ?? status;
};

const typeLabel = (type: string) => {
  const t = type.toLowerCase();
  if (t === "consultation") return "Consultation";
  if (t === "follow_up") return "Follow-up";
  if (t === "check_up") return "Check-up";
  if (t === "procedure") return "Procedure";
  if (t === "other") return "Other";
  return type;
};

function formatTime(value: string): string {
  const parts = (value ?? "").split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (parts.length < 2 || Number.isNaN(h) || Number.isNaN(m)) return "—";
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatDate(value: string): string {
  const [y, m, d] = (value ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value ? value : "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}

function formatTimestamp(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AppointmentsPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Dropdown data (real data from PostgreSQL — no hardcoded options).
  const [patients, setPatients] = useState<PatientOptionRaw[]>([]);
  const [doctors, setDoctors] = useState<DoctorOptionRaw[]>([]);
  const [clinics, setClinics] = useState<ClinicOptionRaw[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [clinicsLoading, setClinicsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [doctorFilter, setDoctorFilter] = useState("All");
  const [clinicFilter, setClinicFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentRecord | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AppointmentRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
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
        return;
      }
      setAppointments(result.data.map(mapApiAppointment));
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  const loadDropdownData = useCallback(async () => {
    setPatientsLoading(true);
    setDoctorsLoading(true);
    setClinicsLoading(true);
    // Patients (camelCase API)
    authFetch("/api/patients")
      .then(async (res) => (await res.json()) as { data: Record<string, unknown>[] | null })
      .then((json) => {
        setPatients(
          (json.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            patient_id: String(r.patient_id ?? ""),
            full_name: String(r.full_name ?? ""),
          }))
        );
      })
      .catch(() => setPatients([]))
      .finally(() => setPatientsLoading(false));
    // Doctors (existing GET /api/doctors list; camelCase API)
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
    // Clinics (snake_case API)
    authFetch("/api/clinics")
      .then(async (res) => (await res.json()) as { data: Record<string, unknown>[] | null })
      .then((json) => {
        setClinics(
          (json.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            clinic_name: String(r.clinic_name ?? ""),
            city: typeof r.city === "string" ? r.city : null,
          }))
        );
      })
      .catch(() => setClinics([]))
      .finally(() => setClinicsLoading(false));
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadAppointments();
      loadDropdownData();
    }
  }, [authLoading, me, loadAppointments, loadDropdownData]);

  // Deep link from the Calendar module: /dashboard/appointments?date=YYYY-MM-DD
  // The selected date is applied to the EXISTING date filter above — no
  // second filter, no second table, no API change. Opening this page without
  // a date parameter keeps the default view untouched.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("date");
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      setDateFilter(raw);
    }
  }, []);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(appointment: AppointmentRecord) {
    setEditing(appointment);
    setViewId(null);
    setFormOpen(true);
  }

  // ---------------- Client-side search + filters ----------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appointments.filter((a) => {
      if (statusFilter !== "All" && statusLabel(a.status) !== statusFilter) return false;
      if (typeFilter !== "All" && typeLabel(a.appointmentType) !== typeFilter) return false;
      if (doctorFilter !== "All" && a.doctorId !== doctorFilter) return false;
      if (clinicFilter !== "All" && a.clinicId !== clinicFilter) return false;
      if (dateFilter && a.appointmentDate.slice(0, 10) !== dateFilter) return false;
      if (!q) return true;
      return (
        a.appointmentId.toLowerCase().includes(q) ||
        a.patientName.toLowerCase().includes(q) ||
        a.doctorName.toLowerCase().includes(q) ||
        a.clinicName.toLowerCase().includes(q) ||
        (a.patientPhone ?? "").toLowerCase().includes(q)
      );
    });
  }, [appointments, search, statusFilter, typeFilter, doctorFilter, clinicFilter, dateFilter]);

  const hasActiveFilters =
    search.trim() !== "" ||
    statusFilter !== "All" ||
    typeFilter !== "All" ||
    doctorFilter !== "All" ||
    clinicFilter !== "All" ||
    dateFilter !== "";

  async function confirmCancel() {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const response = await authFetch(`/api/appointments/${cancelTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: cancelTarget.patientId,
          doctorId: cancelTarget.doctorId,
          clinicId: cancelTarget.clinicId,
          appointmentDate: cancelTarget.appointmentDate.slice(0, 10),
          appointmentTime: cancelTarget.appointmentTime.slice(0, 5),
          appointmentType: cancelTarget.appointmentType,
          status: "cancelled",
        }),
      });
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        showToast("Appointment cancelled successfully.");
        setCancelTarget(null);
        await loadAppointments();
      } else {
        showToast(result.message ?? "Unable to cancel appointment.");
      }
    } catch {
      showToast("Could not reach the server.");
    } finally {
      setCancelling(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await authFetch(`/api/appointments/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        showToast("Appointment deleted successfully.");
        setDeleteTarget(null);
        await loadAppointments();
      } else {
        showToast(result.message ?? "Unable to delete appointment.");
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
          <p className="text-sm text-[#5B6B7C]">Loading appointments...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load appointment information.</p>
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
  const patientsReady = !patientsLoading;
  const doctorsReady = !doctorsLoading;
  const clinicsReady = !clinicsLoading;

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
              <h1 className="text-2xl font-bold text-slate-900">Appointments Management</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Manage patient appointments, doctors, clinics, schedules, and appointment status.
              </p>
            </div>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600"
            >
              <Plus size={16} /> Add Appointment
            </button>
          </div>

          {/* Search + filters — one horizontal row on desktop, wraps gracefully on smaller screens */}
          <div className="mt-6 flex flex-wrap items-center gap-3 lg:flex-nowrap">
            <div className="relative w-full min-w-0 lg:w-auto lg:min-w-[160px] lg:max-w-[320px] lg:flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#83909D]"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search appointments..."
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] py-2.5 pl-10 pr-4 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
              />
            </div>
            <FormSelect
              className="w-[150px] min-w-0 lg:w-[136px]"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS.map((s) => ({
                value: s,
                label: s === "All" ? "Status: All" : `Status: ${s}`,
              }))}
            />
            <FormSelect
              className="w-[150px] min-w-0 lg:w-[132px]"
              value={typeFilter}
              onChange={setTypeFilter}
              options={TYPE_FILTERS.map((t) => ({
                value: t,
                label: t === "All" ? "Type: All" : `Type: ${t}`,
              }))}
            />
            <FormSelect
              className="w-[190px] min-w-0 lg:w-[180px]"
              value={doctorFilter}
              onChange={setDoctorFilter}
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
              options={[
                { value: "All", label: "Clinic: All clinics" },
                ...clinics.map((c) => ({
                  value: c.id,
                  label: c.clinic_name,
                  hint: c.city ?? undefined,
                })),
              ]}
            />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="min-w-0 rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-3 py-2.5 text-sm text-[#1E293B] outline-none transition focus:border-[#0369A1] [color-scheme:light]"
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("All");
                  setTypeFilter("All");
                  setDoctorFilter("All");
                  setClinicFilter("All");
                  setDateFilter("");
                }}
                className="shrink-0 rounded-xl border border-[#E2E8F0] px-3 py-2.5 text-sm text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse border-b border-[#E2E8F0] last:border-b-0" />
              ))}
            </div>
          ) : appointments.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <CalendarDays size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">No appointments added yet.</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                {patientsReady && patients.length === 0
                  ? "No patients available. Add a patient first."
                  : doctorsReady && doctors.length === 0
                    ? "No doctors available. Add a doctor first."
                    : clinicsReady && clinics.length === 0
                      ? "No clinics available. Add a clinic first."
                      : "Schedule your first appointment to get started."}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <p className="text-sm font-medium text-slate-900">No appointments match your search.</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Try a different appointment ID, name, phone, or clear the filters.
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="divide-x divide-[#E2E8F0]/60 bg-[#EEF2F7] text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5 first:pl-5">Appointment</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">Patient</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">Doctor</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">Clinic</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">Date & Time</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">Type</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">Status</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">Created</th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5 text-right last:pr-5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a) => (
                      <tr
                        key={a.id}
                        className="divide-x divide-[#E2E8F0]/40 border-b border-[#E2E8F0] transition-colors last:border-b-0 hover:bg-[#E8EEF4]"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[#5B6B7C] first:pl-5">
                          {a.appointmentId}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium leading-tight text-[#1E293B]">{a.patientName}</p>
                          <p className="mt-0.5 text-[11px] leading-tight text-[#83909D]">{a.patientCode}</p>
                        </td>
                        <td className="px-4 py-3 text-[#5B6B7C]">{a.doctorName}</td>
                        <td className="px-4 py-3 text-[#5B6B7C]">{a.clinicName}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#5B6B7C]">
                          {formatDate(a.appointmentDate)} · {formatTime(a.appointmentTime)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#5B6B7C]">
                          {typeLabel(a.appointmentType)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusChip(
                              a.status
                            )}`}
                          >
                            {statusLabel(a.status)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#5B6B7C]">
                          {formatTimestamp(a.createdAt)}
                        </td>
                        <td className="px-4 py-3 last:pr-5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setViewId(a.id)}
                              title="View appointment"
                              className="rounded-lg border border-[#E2E8F0] p-1.5 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(a)}
                              title="Edit appointment"
                              className="rounded-lg border border-[#E2E8F0] p-1.5 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                            >
                              <Pencil size={14} />
                            </button>
                            {a.status.toLowerCase() !== "cancelled" && (
                              <button
                                type="button"
                                onClick={() => setCancelTarget(a)}
                                title="Cancel appointment"
                                className="rounded-lg border border-[#E2E8F0] p-1.5 text-[#5B6B7C] transition hover:border-amber-400 hover:text-amber-700"
                              >
                                <XCircle size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(a)}
                              title="Delete appointment permanently"
                              className="rounded-lg border border-[#E2E8F0] p-1.5 text-[#5B6B7C] transition hover:border-red-600 hover:text-red-600"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* View modal */}
      {viewId && (
        <AppointmentDetail
          appointmentId={viewId}
          onClose={() => setViewId(null)}
          onEdit={(appointment) => openEdit(appointment)}
        />
      )}

      {/* Add/Edit modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setFormOpen(false)}
        >
          <div
            className="my-8 w-full max-w-3xl rounded-3xl border border-[#E2E8F0] bg-[#F8FAFC] p-6 shadow-2xl sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900">
                {editing ? "Edit Appointment" : "Add Appointment"}
              </h2>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                {editing
                  ? `Editing ${editing.appointmentId}`
                  : "Schedule a new appointment for your clinic."}
              </p>
            </div>
            <AppointmentForm appointment={editing}
              patients={patients.map((p) => ({
                id: p.id,
                fullName: p.full_name,
                patientId: p.patient_id,
              }))}
              doctors={doctors.map((d) => ({
                id: d.id,
                fullName: d.full_name,
                specialty: d.specialty,
              }))}
              clinics={clinics.map((c) => ({
                id: c.id,
                clinicName: c.clinic_name,
                city: c.city,
              }))}
              patientsLoading={patientsLoading}
              doctorsLoading={doctorsLoading}
              clinicsLoading={clinicsLoading}
              onSaved={(message) => {
                setFormOpen(false);
                showToast(message);
                loadAppointments();
              }}
              onCancel={() => setFormOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Cancel confirmation */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Cancel Appointment</h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              Are you sure you want to cancel this appointment?
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {cancelTarget.appointmentId} · {cancelTarget.patientName}
            </p>
            <p className="mt-1 text-xs text-[#83909D]">
              The appointment will be kept for history with status &ldquo;Cancelled&rdquo;.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={cancelling}
                className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                {cancelling ? "Cancelling..." : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Delete Appointment</h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              Are you sure you want to permanently delete this appointment?
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {deleteTarget.appointmentId} · {deleteTarget.patientName}
            </p>
            <p className="mt-1 text-xs text-[#83909D]">
              Cancelling is preferred so records stay available for visits and history.
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
