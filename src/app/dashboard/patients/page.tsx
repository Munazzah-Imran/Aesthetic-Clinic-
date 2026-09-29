"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Plus, RotateCcw, CheckCircle2, Search, Pencil, Trash2, Eye } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import PatientDetail, { type PatientRecord } from "@/components/dashboard/PatientDetail";
import PatientForm from "@/components/dashboard/PatientForm";
import FormSelect from "@/components/dashboard/FormSelect";
import { useAuthMe } from "@/lib/useAuthMe";

const GENDER_FILTERS = ["All", "Male", "Female", "Other"];
const STATUS_FILTERS = ["All", "Active", "Inactive", "Archived"];

type PatientApi = {
  id: string;
  patient_id: string;
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  age: number | string | null;
  marital_status: string | null;
  phone: string | null;
  alternate_phone: string | null;
  email: string | null;
  full_address: string | null;
  city: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

function toRecord(p: PatientApi): PatientRecord {
  return {
    id: p.id,
    patientId: p.patient_id,
    fullName: p.full_name,
    gender: p.gender,
    dateOfBirth: p.date_of_birth,
    age: p.age === null || p.age === undefined || p.age === "" ? null : Number(p.age),
    maritalStatus: p.marital_status,
    phone: p.phone,
    alternatePhone: p.alternate_phone,
    email: p.email,
    fullAddress: p.full_address,
    city: p.city,
    emergencyContactName: p.emergency_contact_name,
    emergencyContactRelationship: p.emergency_contact_relationship,
    emergencyContactPhone: p.emergency_contact_phone,
    status: p.status,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function formatRegistration(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const statusChip = (status: string) => {
  const s = status.toLowerCase();
  if (s === "active") return "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30";
  if (s === "inactive") return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-[#E2E8F0]/60 text-[#5B6B7C] border-[#E2E8F0]";
};

const statusLabel = (status: string) => {
  const s = status.toLowerCase();
  if (s === "active") return "Active";
  if (s === "inactive") return "Inactive";
  return "Archived";
};

export default function PatientsPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [formOpen, setFormOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<PatientRecord | null>(null);
  const [viewPatientId, setViewPatientId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PatientRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadPatients = useCallback(async () => {
    setPatientsLoading(true);
    try {
      const response = await authFetch("/api/patients");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: PatientApi[] | null;
        success: boolean;
      };
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        setPatients([]);
        return;
      }
      setPatients(result.data.map(toRecord));
    } catch {
      setPatients([]);
    } finally {
      setPatientsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadPatients();
    }
  }, [authLoading, me, loadPatients]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  function openAdd() {
    setEditingPatient(null);
    setFormOpen(true);
  }

  function openEdit(patient: PatientRecord) {
    setEditingPatient(patient);
    setViewPatientId(null);
    setFormOpen(true);
  }

  // ---------------- Client-side search + filters ----------------
  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return patients.filter((p) => {
      if (genderFilter !== "All" && (p.gender ?? "") !== genderFilter) return false;
      if (statusFilter !== "All" && statusLabel(p.status) !== statusFilter) return false;
      if (!q) return true;
      return (
        p.fullName.toLowerCase().includes(q) ||
        p.patientId.toLowerCase().includes(q) ||
        (p.phone ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [patients, search, genderFilter, statusFilter]);

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await authFetch(`/api/patients/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        showToast("Patient deleted successfully.");
        setDeleteTarget(null);
        await loadPatients();
      } else {
        showToast(result.message ?? "Unable to delete patient.");
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
          <p className="text-sm text-[#5B6B7C]">Loading patients...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load patient information.</p>
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
  const hasActiveFilters =
    search.trim() !== "" || genderFilter !== "All" || statusFilter !== "All";

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
              <h1 className="text-2xl font-bold text-slate-900">Patients Management</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Manage patient records, contact information, medical details, and visit history.
              </p>
            </div>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600"
            >
              <Plus size={16} /> Add Patient
            </button>
          </div>

          {/* Search + filters */}
          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-sm">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#83909D]"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patients..."
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] py-2.5 pl-10 pr-4 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <FormSelect
                className="w-[150px]"
                value={genderFilter}
                onChange={setGenderFilter}
                options={GENDER_FILTERS.map((g) => ({
                  value: g,
                  label: g === "All" ? "Gender: All" : `Gender: ${g}`,
                }))}
              />
              <FormSelect
                className="w-[150px]"
                value={statusFilter}
                onChange={setStatusFilter}
                options={STATUS_FILTERS.map((s) => ({
                  value: s,
                  label: s === "All" ? "Status: All" : `Status: ${s}`,
                }))}
              />
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setGenderFilter("All");
                    setStatusFilter("All");
                  }}
                  className="rounded-xl border border-[#E2E8F0] px-3 py-2.5 text-sm text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          {patientsLoading ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse border-b border-[#E2E8F0] last:border-b-0" />
              ))}
            </div>
          ) : patients.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <Users size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">No patients added yet.</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Add your first patient to get started.
              </p>
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <p className="text-sm font-medium text-slate-900">No patients match your search.</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Try a different name, patient ID, phone or email.
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-xs uppercase tracking-wider text-[#83909D]">
                    <th className="px-4 py-3.5 font-medium">Patient</th>
                    <th className="px-4 py-3.5 font-medium">Patient ID</th>
                    <th className="px-4 py-3.5 font-medium">Gender</th>
                    <th className="px-4 py-3.5 font-medium">Age</th>
                    <th className="px-4 py-3.5 font-medium">Contact Number</th>
                    <th className="px-4 py-3.5 font-medium">City</th>
                    <th className="px-4 py-3.5 font-medium">Registered</th>
                    <th className="px-4 py-3.5 font-medium">Status</th>
                    <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPatients.map((p) => {
                    const dob = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
                    let age: string;
                    if (p.age !== null && p.age !== undefined && !Number.isNaN(Number(p.age))) {
                      age = String(p.age);
                    } else if (dob && !Number.isNaN(dob.getTime())) {
                      const now = new Date();
                      let a = now.getFullYear() - dob.getFullYear();
                      const m = now.getMonth() - dob.getMonth();
                      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) a--;
                      age = String(a);
                    } else {
                      age = "—";
                    }
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-[#E2E8F0] transition-colors last:border-b-0 hover:bg-[#F1F5F9]/50"
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0369A1]/15 text-xs font-semibold text-[#0369A1]">
                              {initialsOf(p.fullName)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[#1E293B]">{p.fullName}</p>
                              {p.email && (
                                <p className="truncate text-xs text-[#83909D]">{p.email}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-[#5B6B7C]">
                          {p.patientId}
                        </td>
                        <td className="px-4 py-3.5 text-[#5B6B7C]">{p.gender ?? "—"}</td>
                        <td className="px-4 py-3.5 text-[#5B6B7C]">{age}</td>
                        <td className="px-4 py-3.5 text-[#5B6B7C]">{p.phone ?? "—"}</td>
                        <td className="px-4 py-3.5 text-[#5B6B7C]">{p.city ?? "—"}</td>
                        <td className="px-4 py-3.5 text-[#5B6B7C]">
                          {formatRegistration(p.createdAt)}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusChip(
                              p.status
                            )}`}
                          >
                            {statusLabel(p.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewPatientId(p.id)}
                              title="View patient"
                              className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              title="Edit patient"
                              className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(p)}
                              title="Delete patient"
                              className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-red-600 hover:text-red-600"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* View modal */}
      {viewPatientId && (
        <PatientDetail
          patientId={viewPatientId}
          onClose={() => setViewPatientId(null)}
          onEdit={(patient) => openEdit(patient)}
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
                {editingPatient ? "Edit Patient" : "Add Patient"}
              </h2>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                {editingPatient
                  ? `Editing ${editingPatient.fullName} (${editingPatient.patientId})`
                  : "Register a new patient for your clinic."}
              </p>
            </div>
            <PatientForm
              patient={editingPatient}
              onSaved={(message) => {
                setFormOpen(false);
                showToast(message);
                loadPatients();
              }}
              onCancel={() => setFormOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Delete Patient</h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              Are you sure you want to delete this patient?
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {deleteTarget.fullName} ({deleteTarget.patientId})
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
