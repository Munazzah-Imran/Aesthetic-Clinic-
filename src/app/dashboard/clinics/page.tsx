"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Plus, RotateCcw, CheckCircle2 } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import ClinicCard, { type Clinic } from "@/components/dashboard/ClinicCard";
import ClinicForm, { type ClinicFormValues } from "@/components/dashboard/ClinicForm";
import { useAuthMe } from "@/lib/useAuthMe";

type DeleteTarget = Clinic | null;

export default function ClinicsPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [clinicsLoading, setClinicsLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingClinic, setEditingClinic] = useState<Clinic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadClinics = useCallback(async () => {
    setClinicsLoading(true);
    try {
      const response = await authFetch("/api/clinics");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: Clinic[] | null;
        success: boolean;
      };
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        setClinics([]);
        return;
      }
      setClinics(result.data);
    } catch {
      setClinics([]);
    } finally {
      setClinicsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadClinics();
    }
  }, [authLoading, me, loadClinics]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  function openAdd() {
    setEditingClinic(null);
    setFormOpen(true);
  }

  function openEdit(clinic: Clinic) {
    setEditingClinic(clinic);
    setFormOpen(true);
  }

  /** Create or update; returns an error message or null on success. */
  async function submitClinic(values: ClinicFormValues): Promise<string | null> {
    try {
      const url = editingClinic
        ? `/api/clinics/${editingClinic.id}`
        : "/api/clinics";
      const response = await authFetch(url, {
        method: editingClinic ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const result = (await response.json()) as {
        data: { errors?: Record<string, string> } | null;
        error: string | null;
        success: boolean;
        message: string;
      };

      if (response.ok && result.success) {
        await loadClinics();
        return null;
      }

      // Server-side validation errors.
      if (result.data && typeof result.data === "object" && "errors" in result.data) {
        const serverErrors = result.data.errors as Record<string, string>;
        // Show duplicate-code error from the API prominently.
        return Object.values(serverErrors)[0] ?? result.message;
      }

      return result.error ?? result.message ?? "Unable to save clinic.";
    } catch {
      return "Could not reach the server. Please try again.";
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await authFetch(`/api/clinics/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        showToast("Clinic deleted successfully.");
        setDeleteTarget(null);
        await loadClinics();
      } else {
        showToast(result.message ?? "Unable to delete clinic.");
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
          <p className="text-sm text-[#5B6B7C]">Loading clinic locations...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load clinic information.</p>
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
              <h1 className="text-2xl font-bold text-slate-900">
                Clinic Locations Management
              </h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Manage clinic addresses, maps, working hours, and availability status.
              </p>
            </div>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600"
            >
              <Plus size={16} /> Add Clinic
            </button>
          </div>

          {/* Content */}
          {clinicsLoading ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-64 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]"
                />
              ))}
            </div>
          ) : clinics.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <Building2 size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                No clinic locations added yet.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Add your first clinic location to get started.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {clinics.map((clinic) => (
                <ClinicCard
                  key={clinic.id}
                  clinic={clinic}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Add/Edit modal */}
      <ClinicForm
        open={formOpen}
        clinic={editingClinic}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => {
          setFormOpen(false);
          showToast(editingClinic ? "Clinic updated successfully." : "Clinic added successfully.");
          void msg;
        }}
        submit={submitClinic}
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Delete Clinic</h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              Are you sure you want to delete this clinic location?
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {deleteTarget.clinic_name} ({deleteTarget.city_code})
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
                {deleting ? "Deleting..." : "Delete Clinic"}
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
