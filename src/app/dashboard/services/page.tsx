"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  HeartPulse,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import FormSelect from "@/components/dashboard/FormSelect";
import {
  STATUS_LABELS,
  STATUS_STYLES,
} from "@/components/dashboard/ClinicCard";
import { useAuthMe } from "@/lib/useAuthMe";
import {
  SERVICE_STATUSES,
  validateService,
  type ServiceFieldErrors,
  type ServiceItem,
} from "@/lib/services";

type FormMode = { mode: "add" } | { mode: "edit"; service: ServiceItem };

const STATUS_OPTIONS = SERVICE_STATUSES.map((s) => ({
  value: s,
  label: s === "active" ? "Active" : "Inactive",
}));

const ALL_CATEGORIES = "__all__";

/**
 * Services / Treatments — the treatment catalogue of the authenticated
 * business, loaded live from PostgreSQL through GET /api/services.
 * Nothing is hardcoded: titles, categories and statuses all come from the
 * database and stay isolated per business.
 */
export default function ServicesPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // Search + category filter (pure client-side, no page reloads).
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);

  // Add / Edit form.
  const [form, setForm] = useState<FormMode | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formStatus, setFormStatus] = useState("active");
  const [fieldErrors, setFieldErrors] = useState<ServiceFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation.
  const [deleteTarget, setDeleteTarget] = useState<ServiceItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await authFetch("/api/services");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: ServiceItem[] | null;
        success: boolean;
      };
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        setServices([]);
        setLoadFailed(true);
        return;
      }
      setServices(result.data);
    } catch {
      setServices([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadServices();
    }
  }, [authLoading, me, loadServices]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  // Categories come from the actual service data (never hardcoded).
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of services) set.add(s.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [services]);

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (categoryFilter !== ALL_CATEGORIES && s.category !== categoryFilter) {
        return false;
      }
      if (q === "") return true;
      return (
        s.serviceTitle.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    });
  }, [services, search, categoryFilter]);

  function openAdd() {
    setForm({ mode: "add" });
    setFormTitle("");
    setFormCategory("");
    setFormStatus("active");
    setFieldErrors({});
    setSubmitError(null);
  }

  function openEdit(service: ServiceItem) {
    setForm({ mode: "edit", service });
    setFormTitle(service.serviceTitle);
    setFormCategory(service.category);
    setFormStatus(service.status);
    setFieldErrors({});
    setSubmitError(null);
  }

  /** Creates (add) or updates (edit) the service — never both. */
  async function submitForm() {
    if (!form || saving) return;
    setSaving(true);
    setFieldErrors({});
    setSubmitError(null);

    const isEdit = form.mode === "edit";
    const url = isEdit ? `/api/services/${form.service.id}` : "/api/services";
    const method = isEdit ? "PATCH" : "POST";

    try {
      const response = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceTitle: formTitle,
          category: formCategory,
          status: formStatus,
        }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: { errors?: ServiceFieldErrors } | null;
        error: string | null;
        success: boolean;
        message: string;
      };

      if (response.ok && result.success) {
        setForm(null);
        await loadServices();
        showToast(isEdit ? "Service updated." : "Service added.");
        return;
      }

      if (
        response.status === 400 &&
        result.data &&
        typeof result.data === "object" &&
        "errors" in result.data &&
        result.data.errors
      ) {
        setFieldErrors(result.data.errors);
        setSubmitError(result.message ?? "Please fix the highlighted fields.");
        return;
      }

      setSubmitError(
        result.message ?? result.error ?? (isEdit ? "Unable to update service." : "Unable to add service.")
      );
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
      const response = await authFetch(`/api/services/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        // Remove from the table immediately — no browser refresh needed.
        setServices((prev) => prev.filter((s) => s.id !== deleteTarget.id));
        setDeleteTarget(null);
        showToast("Service removed.");
      } else {
        showToast(result.message ?? "Unable to remove service.");
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
          <p className="text-sm text-[#5B6B7C]">Loading services...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load services.</p>
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
                Doctor Services Directory
              </h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Manage services, consultation types, and treatment procedures offered by doctors.
              </p>
            </div>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600"
            >
              <Plus size={16} /> Add Service
            </button>
          </div>

          {/* Search + category filter */}
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
                placeholder="Search services..."
                aria-label="Search services"
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] py-2.5 pl-10 pr-4 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <FormSelect
                className="w-full sm:w-[220px]"
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder="All Categories"
                options={[
                  { value: ALL_CATEGORIES, label: "All Categories" },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
              />
              {search.trim() !== "" || categoryFilter !== ALL_CATEGORIES ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategoryFilter(ALL_CATEGORIES);
                  }}
                  className="rounded-xl border border-[#E2E8F0] px-3 py-2.5 text-sm text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse border-b border-[#E2E8F0] last:border-b-0"
                />
              ))}
            </div>
          ) : loadFailed ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
                <RotateCcw size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                Unable to load services.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Please check your connection and try again.
              </p>
              <button
                type="button"
                onClick={loadServices}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          ) : services.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <HeartPulse size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                No services or treatments added yet.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Add your first service to get started.
              </p>
              <button
                type="button"
                onClick={openAdd}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <Plus size={16} /> Add Service
              </button>
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <p className="text-sm font-medium text-slate-900">
                No services match your search.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Try a different title or category.
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-xs uppercase tracking-wider text-[#83909D]">
                    <th className="px-4 py-3.5 font-medium">Service Title</th>
                    <th className="px-4 py-3.5 font-medium">Category</th>
                    <th className="px-4 py-3.5 font-medium">Status</th>
                    <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map((service) => (
                    <tr
                      key={service.id}
                      className="border-b border-[#E2E8F0] transition-colors last:border-b-0 hover:bg-[#F1F5F9]/50"
                    >
                      <td className="max-w-[320px] px-4 py-3.5">
                        <p className="whitespace-normal font-medium text-[#1E293B]">
                          {service.serviceTitle}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 text-[#5B6B7C]">
                        {service.category}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${
                            STATUS_STYLES[service.status] ?? STATUS_STYLES.inactive
                          }`}
                        >
                          {STATUS_LABELS[service.status] ?? service.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(service)}
                            title="Edit service"
                            aria-label="Edit service"
                            className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(service)}
                            title="Delete service"
                            aria-label="Delete service"
                            className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-red-600 hover:text-red-600"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* Add / Edit modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">
              {form.mode === "edit" ? "Edit Service" : "Add Service"}
            </h3>
            <p className="mt-1 text-sm text-[#5B6B7C]">
              {form.mode === "edit"
                ? "Update the service details below."
                : "Add a new treatment or consultation service."}
            </p>

            {submitError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {submitError}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="service-title"
                  className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                >
                  Service Title <span className="ml-1 text-sky-600">*</span>
                </label>
                <input
                  id="service-title"
                  type="text"
                  maxLength={255}
                  placeholder="e.g. Acne Assessment & Scar Treatment"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-[#83909D] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                    fieldErrors.serviceTitle ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {fieldErrors.serviceTitle && (
                  <p className="text-xs text-red-600">{fieldErrors.serviceTitle}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="service-category"
                  className="text-xs font-medium tracking-wide text-[#5B6B7C]"
                >
                  Category <span className="ml-1 text-sky-600">*</span>
                </label>
                <input
                  id="service-category"
                  type="text"
                  maxLength={100}
                  placeholder="e.g. Acne Care"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-[#83909D] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
                    fieldErrors.category ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {fieldErrors.category && (
                  <p className="text-xs text-red-600">{fieldErrors.category}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Status <span className="ml-1 text-sky-600">*</span>
                </label>
                <FormSelect
                  id="service-status"
                  value={formStatus}
                  onChange={setFormStatus}
                  options={STATUS_OPTIONS}
                  hasError={Boolean(fieldErrors.status)}
                />
                {fieldErrors.status && (
                  <p className="text-xs text-red-600">{fieldErrors.status}</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setForm(null)}
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
                  : form.mode === "edit"
                    ? "Save Changes"
                    : "Add Service"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Delete Service</h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">Delete this service?</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {deleteTarget.serviceTitle}
            </p>
            <p className="mt-0.5 text-xs text-[#5B6B7C]">{deleteTarget.category}</p>
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
