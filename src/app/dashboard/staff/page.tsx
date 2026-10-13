"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  KeyRound,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserCheck,
  UserX,
  UsersRound,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import PasswordInput from "@/components/PasswordInput";
import TopNavbar from "@/components/dashboard/TopNavbar";
import FormSelect from "@/components/dashboard/FormSelect";
import PermissionPicker from "@/components/dashboard/PermissionPicker";
import { useAuthMe } from "@/lib/useAuthMe";
import { usePermissions } from "@/lib/usePermissions";
import { isAssignablePermissionKey, PERMISSIONS } from "@/lib/permissions";
import {
  ACCOUNT_STATUSES,
  DESIGNATION_PRESETS,
  validateInitialPassword,
  validatePermissionKeys,
  validateStaffDetails,
  type AccountStatus,
  type StaffFieldErrors,
  type StaffRecord,
} from "@/lib/staff";

type ModalState =
  | { kind: "add" }
  | { kind: "edit"; id: string }
  | { kind: "view"; id: string }
  | { kind: "permissions"; id: string }
  | { kind: "delete"; staff: StaffRecord }
  | { kind: "toggle"; staff: StaffRecord }
  | null;

const DESIGNATION_OPTIONS = [
  ...DESIGNATION_PRESETS.map((d) => ({ value: d, label: d })),
];

const STATUS_OPTIONS = ACCOUNT_STATUSES.map((s) => ({
  value: s,
  label: s === "active" ? "Active" : "Inactive",
}));

const LABEL_BY_KEY = new Map<string, string>(PERMISSIONS.map((p) => [p.key, p.label]));

function permissionLabels(keys: string[]): string[] {
  return keys.map((k) => LABEL_BY_KEY.get(k) ?? k);
}

function summarizePermissions(keys: string[]): string {
  const labels = permissionLabels(keys);
  if (labels.length === 0) return "No pages";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

/**
 * Staff Management — REAL database-backed accounts and permissions.
 *
 * Lists the authenticated business's staff (GET /api/staff), creates login
 * accounts in the EXISTING users table (never a duplicate auth table), and
 * edits details / page permissions through the admin-only staff APIs.
 * The business owner (admin) is resolved server-side and never appears in
 * this list, so their account can never be edited or deactivated here.
 */
export default function StaffManagementPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const { data: perms } = usePermissions();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = Boolean(perms?.isAdmin);

  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [search, setSearch] = useState("");

  // One modal state machine: Add / Edit / View / Manage Permissions / Status toggle.
  const [modal, setModal] = useState<ModalState>(null);
  const [modalStaff, setModalStaff] = useState<StaffRecord | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Add/Edit form fields.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designationChoice, setDesignationChoice] = useState("");
  const [designationCustom, setDesignationCustom] = useState("");
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("active");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formPermissions, setFormPermissions] = useState<string[]>([]);

  const [fieldErrors, setFieldErrors] = useState<StaffFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Two-step Add/Edit form: 1 = Staff Account Setup, 2 = Assign Permissions.
  const [formStep, setFormStep] = useState<1 | 2>(1);

  // Manage-permissions modal selection (independent of the add/edit form).
  const [managedPermissions, setManagedPermissions] = useState<string[] | null>(null);

  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      // Bounded wait: a hung/slow server must surface a Retry state, not an
      // endless skeleton. 30s leaves room for a cold dev-server compile.
      const response = await authFetch("/api/staff", { signal: AbortSignal.timeout(30000) });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: StaffRecord[] | null;
        success: boolean;
        message: string;
      };
      if (!response.ok || !result.success || !Array.isArray(result.data)) {
        setStaff([]);
        setLoadFailed(true);
        return;
      }
      setStaff(result.data);
    } catch {
      setStaff([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadStaff();
    }
  }, [authLoading, me, loadStaff]);

  // Client-side search by name, email or staff ID.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return staff;
    return staff.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.staffId.toLowerCase().includes(q)
    );
  }, [staff, search]);

  function resetForm() {
    setFullName("");
    setEmail("");
    setPhone("");
    setDesignationChoice("");
    setDesignationCustom("");
    setAccountStatus("active");
    setPassword("");
    setConfirmPassword("");
    setFormPermissions([]);
    setFieldErrors({});
    setSubmitError(null);
  }

  /** Opens the modal and, for existing staff, loads FRESH data from the API. */
  function openModal(next: NonNullable<ModalState>) {
    setSubmitError(null);
    setFieldErrors({});
    setModalError(null);
    setModalStaff(null);
    setManagedPermissions(null);
    setFormStep(1);
    setModal(next);

    if (next.kind === "add") {
      resetForm();
      return;
    }

    if (next.kind === "toggle" || next.kind === "delete") {
      return;
    }

    // edit / view / permissions — always reload from PostgreSQL so the form
    // never shows stale or another profile's data.
    setModalLoading(true);
    (async () => {
      try {
        const response = await authFetch(`/api/staff/${next.id}`, {
          signal: AbortSignal.timeout(30000),
        });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const result = (await response.json()) as {
          data: StaffRecord | null;
          success: boolean;
          message: string;
        };
        if (!response.ok || !result.success || !result.data) {
          setModalError(result.message ?? "Unable to load staff member.");
          return;
        }
        const record = result.data;
        setModalStaff(record);

        if (next.kind === "edit") {
          setFullName(record.fullName);
          setEmail(record.email);
          setPhone(record.phone ?? "");
          const preset = DESIGNATION_PRESETS.find((d) => d === record.designation);
          if (preset) {
            setDesignationChoice(preset);
            setDesignationCustom("");
          } else {
            setDesignationChoice("Other");
            setDesignationCustom(record.designation);
          }
          setAccountStatus(record.accountStatus);
          setPassword("");
          setConfirmPassword("");
          // Only still-assignable options are loaded into the form — removed
          // permission options can never be re-submitted from stale state.
          setFormPermissions(record.permissions.filter(isAssignablePermissionKey));
        } else if (next.kind === "permissions") {
          setManagedPermissions(record.permissions.filter(isAssignablePermissionKey));
        }
      } catch {
        setModalError("Could not reach the server. Please try again.");
      } finally {
        setModalLoading(false);
      }
    })();
  }

  function closeModal() {
    setModal(null);
    setModalStaff(null);
    setManagedPermissions(null);
    setModalError(null);
    setFieldErrors({});
    setSubmitError(null);
    setFormStep(1);
  }

  function resolveDesignation(): string {
    if (designationChoice === "Other") return designationCustom.trim();
    return designationChoice.trim();
  }

  /**
   * Step 1 → Step 2 ("Next"). Validates ONLY the Step 1 fields; on failure an
   * inline message is shown and the form stays on Step 1. This never calls the
   * API, so clicking Next repeatedly can never create a duplicate account.
   */
  function goToStepTwo() {
    if (saving || modalLoading || !modal) return;

    const details = validateStaffDetails({
      fullName,
      email,
      phone,
      designation: resolveDesignation(),
      accountStatus,
    });
    const pwdCheck =
      modal.kind === "add"
        ? validateInitialPassword(password, confirmPassword)
        : { ok: true as const, password: "" };

    const errors: StaffFieldErrors = {
      ...(details.ok ? {} : details.errors),
      ...(pwdCheck.ok ? {} : pwdCheck.errors),
    };
    setFieldErrors(errors);
    if (!details.ok || !pwdCheck.ok || Object.keys(errors).length > 0) {
      setSubmitError("Please fix the highlighted fields before continuing.");
      return;
    }
    setSubmitError(null);
    setFormStep(2);
  }

  /**
   * Step 2 → Step 1 ("Back"). All Step 1 values live in this component's
   * state, so they are preserved exactly as entered.
   */
  function backToStepOne() {
    if (saving || !modal) return;
    setSubmitError(null);
    setFieldErrors({});
    setFormStep(1);
  }

  /** True when the add/edit form holds changes that were not saved yet. */
  function hasUnsavedChanges(): boolean {
    if (!modal || (modal.kind !== "add" && modal.kind !== "edit")) return false;

    const touched =
      fullName.trim() !== "" ||
      email.trim() !== "" ||
      phone.trim() !== "" ||
      designationChoice !== "" ||
      designationCustom.trim() !== "" ||
      password !== "" ||
      confirmPassword !== "" ||
      formPermissions.length > 0 ||
      accountStatus !== "active";
    if (modal.kind === "add" || !modalStaff) return touched;

    const preset = DESIGNATION_PRESETS.find((d) => d === modalStaff.designation);
    const samePermissions =
      formPermissions.length === modalStaff.permissions.length &&
      formPermissions.every((key) => modalStaff.permissions.includes(key));

    return (
      fullName.trim() !== modalStaff.fullName ||
      email.trim() !== modalStaff.email ||
      (phone.trim() === "" ? null : phone.trim()) !== (modalStaff.phone ?? null) ||
      designationChoice !== (preset ?? "Other") ||
      designationCustom.trim() !== (preset ? "" : modalStaff.designation) ||
      accountStatus !== modalStaff.accountStatus ||
      !samePermissions
    );
  }

  /** Cancel / ✕ — confirms before discarding unsaved changes. */
  function requestCloseModal() {
    if (saving) return;
    if (hasUnsavedChanges()) {
      const discard = window.confirm(
        "You have unsaved changes. Close the form and discard them?"
      );
      if (!discard) return;
    }
    closeModal();
  }

  /** Creates (add) or updates (edit) — never both; guarded against double submits. */
  async function submitForm() {
    if (saving) return;
    if (!modal || (modal.kind !== "add" && modal.kind !== "edit")) return;

    const isAdd = modal.kind === "add";
    const designation = resolveDesignation();

    const details = validateStaffDetails({
      fullName,
      email,
      phone,
      designation,
      accountStatus,
    });
    const permsCheck = validatePermissionKeys(formPermissions);
    const pwdCheck = isAdd
      ? validateInitialPassword(password, confirmPassword)
      : { ok: true as const, password: "" };

    const errors: StaffFieldErrors = {
      ...(details.ok ? {} : details.errors),
      ...(permsCheck.ok ? {} : { permissions: permsCheck.message }),
      ...(pwdCheck.ok ? {} : pwdCheck.errors),
    };
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0 || !details.ok || !permsCheck.ok || !pwdCheck.ok) {
      // Jump back to the step that owns the failing fields so the admin can
      // see (and fix) the inline validation messages.
      if (!details.ok || !pwdCheck.ok) setFormStep(1);
      setSubmitError("Please fix the highlighted fields.");
      return;
    }

    setSaving(true);
    try {
      const url = isAdd ? "/api/staff" : `/api/staff/${modal.id}`;
      const method = isAdd ? "POST" : "PATCH";
      const body = isAdd
        ? {
            fullName: details.data.fullName,
            email: details.data.email,
            phone: details.data.phone,
            designation: details.data.designation,
            accountStatus: details.data.accountStatus,
            password,
            confirmPassword,
            permissions: permsCheck.keys,
          }
        : {
            fullName: details.data.fullName,
            email: details.data.email,
            phone: details.data.phone,
            designation: details.data.designation,
            accountStatus: details.data.accountStatus,
            permissions: permsCheck.keys,
          };

      const response = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: { errors?: StaffFieldErrors } | null;
        error: string | null;
        success: boolean;
        message: string;
      };

      if (response.ok && result.success) {
        closeModal();
        await loadStaff();
        showToast(isAdd ? "Staff account created." : "Staff member updated.");
        return;
      }

      if (
        response.status === 400 &&
        result.data &&
        typeof result.data === "object" &&
        result.data.errors
      ) {
        const serverErrors = result.data.errors;
        setFieldErrors(serverErrors);
        // Backend-returned Step 1 errors send the admin back to Step 1;
        // permission errors keep them on Step 2. Input is never lost.
        if (
          serverErrors.fullName ||
          serverErrors.email ||
          serverErrors.phone ||
          serverErrors.designation ||
          serverErrors.accountStatus ||
          serverErrors.password ||
          serverErrors.confirmPassword
        ) {
          setFormStep(1);
        }
        setSubmitError(result.message ?? "Please fix the highlighted fields.");
        return;
      }

      setSubmitError(
        result.message ??
          result.error ??
          (isAdd ? "Unable to create staff account." : "Unable to update staff member.")
      );
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /** Manage Permissions modal — PUT replaces the saved permission set. */
  async function savePermissions() {
    if (!modal || modal.kind !== "permissions" || !modalStaff || saving) return;
    if (managedPermissions === null) return;

    const check = validatePermissionKeys(managedPermissions);
    if (!check.ok) {
      setSubmitError(check.message);
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      const response = await authFetch(`/api/staff/${modal.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: check.keys }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: { permissions?: string[] } | null;
        success: boolean;
        message: string;
      };
      if (response.ok && result.success) {
        closeModal();
        await loadStaff(); // refresh the Assigned Pages column from the DB
        showToast("Permissions saved.");
        return;
      }
      setSubmitError(result.message ?? "Unable to save permissions.");
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /** Activate / Deactivate — guarded against double clicks. */
  async function toggleStatus(target: StaffRecord) {
    if (toggling) return;
    const nextStatus: AccountStatus = target.accountStatus === "active" ? "inactive" : "active";
    setToggling(true);
    try {
      const response = await authFetch(`/api/staff/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountStatus: nextStatus }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as { success: boolean; message: string };
      if (response.ok && result.success) {
        closeModal();
        await loadStaff();
        showToast(
          nextStatus === "inactive"
            ? `${target.fullName} deactivated.`
            : `${target.fullName} reactivated.`
        );
      } else {
        showToast(result.message ?? "Unable to update account status.");
      }
    } catch {
      showToast("Could not reach the server.");
    } finally {
      setToggling(false);
    }
  }

  /**
   * Delete Staff — only runs after the admin confirms in the dialog.
   * Guarded against double submissions; errors are shown INSIDE the dialog
   * so the entered context is never lost, success refreshes the list.
   */
  async function deleteStaffMember(target: StaffRecord) {
    if (deleting) return;
    setDeleting(true);
    setSubmitError(null);
    try {
      const response = await authFetch(`/api/staff/${target.id}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        success: boolean;
        message: string;
      };
      if (response.ok && result.success) {
        closeModal();
        await loadStaff(); // refresh the list — the member is gone
        showToast("Staff member deleted.");
        return;
      }
      setSubmitError(result.message ?? "Unable to delete staff member.");
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
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
          <p className="text-sm text-[#5B6B7C]">Loading staff...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load staff management.</p>
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

  const inputClass = (hasError?: string) =>
    `w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-[#83909D] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
      hasError ? "border-red-400/70" : "border-[#E2E8F0]"
    }`;

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
              <h1 className="text-2xl font-bold text-slate-900">Staff Management</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Manage staff members, their accounts, roles, and dashboard access permissions.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => openModal({ kind: "add" })}
                className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600"
              >
                <Plus size={16} /> Add Staff
              </button>
            )}
          </div>

          {/* Search — by name, email or staff ID */}
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
                placeholder="Search by name, email, or staff ID..."
                aria-label="Search staff"
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] py-2.5 pl-10 pr-4 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
              />
            </div>
            {search.trim() !== "" && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="rounded-xl border border-[#E2E8F0] px-3 py-2.5 text-sm text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
              >
                Clear
              </button>
            )}
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
                Unable to load staff members.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Please check your connection and try again.
              </p>
              <button
                type="button"
                onClick={loadStaff}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          ) : staff.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <UsersRound size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                No staff members yet.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                {isAdmin
                  ? "Create your first staff account to grant selective dashboard access."
                  : "Ask the administrator to add staff members."}
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => openModal({ kind: "add" })}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
                >
                  <Plus size={16} /> Add Staff
                </button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <p className="text-sm font-medium text-slate-900">No staff match your search.</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">Try a different name, email, or staff ID.</p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-xs uppercase tracking-wider text-[#83909D]">
                    <th className="px-4 py-3.5 font-medium">Staff ID</th>
                    <th className="px-4 py-3.5 font-medium">Full Name</th>
                    <th className="px-4 py-3.5 font-medium">Email</th>
                    <th className="px-4 py-3.5 font-medium">Phone Number</th>
                    <th className="px-4 py-3.5 font-medium">Designation / Field</th>
                    <th className="px-4 py-3.5 font-medium">Account Status</th>
                    <th className="px-4 py-3.5 font-medium">Assigned Pages</th>
                    <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((member) => (
                    <tr
                      key={member.id}
                      className="border-b border-[#E2E8F0] transition-colors last:border-b-0 hover:bg-[#F1F5F9]/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs font-medium text-[#0369A1]">
                        {member.staffId}
                      </td>
                      <td className="max-w-[180px] px-4 py-3.5">
                        <p className="truncate font-medium text-[#1E293B]">{member.fullName}</p>
                      </td>
                      <td className="max-w-[220px] px-4 py-3.5">
                        <p className="truncate text-[#5B6B7C]">{member.email}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-[#5B6B7C]">
                        {member.phone ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-[#5B6B7C]">
                        {member.designation}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide ${
                            member.accountStatus === "active"
                              ? "bg-emerald-500/15 text-emerald-600"
                              : "bg-slate-500/15 text-slate-500"
                          }`}
                        >
                          {member.accountStatus === "active" ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-4 py-3.5">
                        <p
                          className="truncate text-xs text-[#5B6B7C]"
                          title={permissionLabels(member.permissions).join(", ")}
                        >
                          {summarizePermissions(member.permissions)}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openModal({ kind: "view", id: member.id })}
                            title="View staff member"
                            aria-label={`View ${member.fullName}`}
                            className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                          >
                            <Eye size={15} />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openModal({ kind: "edit", id: member.id })}
                                title="Edit staff member"
                                aria-label={`Edit ${member.fullName}`}
                                className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => openModal({ kind: "permissions", id: member.id })}
                                title="Manage permissions"
                                aria-label={`Manage permissions for ${member.fullName}`}
                                className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                              >
                                <KeyRound size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => openModal({ kind: "toggle", staff: member })}
                                title={
                                  member.accountStatus === "active"
                                    ? "Deactivate account"
                                    : "Activate account"
                                }
                                aria-label={
                                  member.accountStatus === "active"
                                    ? `Deactivate ${member.fullName}`
                                    : `Activate ${member.fullName}`
                                }
                                className={`rounded-lg border p-2 transition ${
                                  member.accountStatus === "active"
                                    ? "border-[#E2E8F0] text-[#5B6B7C] hover:border-red-600 hover:text-red-600"
                                    : "border-[#E2E8F0] text-[#5B6B7C] hover:border-emerald-600 hover:text-emerald-600"
                                }`}
                              >
                                {member.accountStatus === "active" ? (
                                  <UserX size={15} />
                                ) : (
                                  <UserCheck size={15} />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => openModal({ kind: "delete", staff: member })}
                                title="Delete staff member"
                                aria-label={`Delete ${member.fullName}`}
                                className="rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-red-600 hover:text-red-600"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
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

      {/* ---------------- Add / Edit modal ---------------- */}
      {modal && (modal.kind === "add" || modal.kind === "edit") && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="my-6 w-full max-w-3xl rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {modal.kind === "edit" ? "Edit Staff" : "Add Staff"}
                </h3>
                <p className="mt-1 text-sm text-[#5B6B7C]">
                  {modal.kind === "edit"
                    ? "Update this staff member's details and page permissions."
                    : "Create an individual login account with only the pages you assign."}
                </p>
              </div>
              <button
                type="button"
                onClick={requestCloseModal}
                disabled={saving}
                aria-label="Close"
                className="rounded-lg p-1.5 text-[#83909D] transition hover:bg-[#F1F5F9] hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            {/* Two-step progress indicator */}
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    formStep === 1
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-600"
                      : "border-[#E2E8F0] bg-[#F1F5F9] text-[#83909D]"
                  }`}
                >
                  1. Account Setup
                </span>
                <ArrowRight size={14} className="shrink-0 text-[#83909D]" />
                <span
                  className={`rounded-full border px-3 py-1.5 transition-colors ${
                    formStep === 2
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-600"
                      : "border-[#E2E8F0] bg-[#F1F5F9] text-[#83909D]"
                  }`}
                >
                  2. Permissions
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                <div
                  className={`h-full rounded-full bg-sky-500 transition-all duration-300 ${
                    formStep === 1 ? "w-1/2" : "w-full"
                  }`}
                />
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-600">
                Step {formStep} of 2 —{" "}
                {formStep === 1 ? "Staff Account Setup" : "Assign Permissions"}
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                {formStep === 1
                  ? "Enter the staff member's details and set up their account."
                  : "Choose which dashboard sections this staff member can access."}
              </p>
            </div>

            {modalLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
              </div>
            ) : modalError ? (
              <div className="mt-4">
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {modalError}
                </p>
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal(modal)}
                    className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
                  >
                    <RotateCcw size={15} /> Try Again
                  </button>
                </div>
              </div>
            ) : (
              <>
                {submitError && (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {submitError}
                  </p>
                )}

                {formStep === 1 ? (
                  <div className="mt-5 space-y-6">
                  {/* Details — two columns on desktop, stacked on mobile */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#83909D]">
                      Staff Details
                    </p>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="staff-full-name" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                          Full Name <span className="ml-1 text-sky-600">*</span>
                        </label>
                        <input
                          id="staff-full-name"
                          type="text"
                          maxLength={100}
                          placeholder="e.g. Talha Ahmed"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className={inputClass(fieldErrors.fullName)}
                        />
                        {fieldErrors.fullName && (
                          <p className="text-xs text-red-600">{fieldErrors.fullName}</p>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="staff-email" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                          Email Address <span className="ml-1 text-sky-600">*</span>
                        </label>
                        <input
                          id="staff-email"
                          type="email"
                          maxLength={255}
                          placeholder="e.g. talha@clinic.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={inputClass(fieldErrors.email)}
                        />
                        {fieldErrors.email && (
                          <p className="text-xs text-red-600">{fieldErrors.email}</p>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="staff-phone" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                          Phone Number
                        </label>
                        <input
                          id="staff-phone"
                          type="tel"
                          maxLength={30}
                          placeholder="Optional"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className={inputClass(fieldErrors.phone)}
                        />
                        {fieldErrors.phone && (
                          <p className="text-xs text-red-600">{fieldErrors.phone}</p>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                          Designation / Field <span className="ml-1 text-sky-600">*</span>
                        </label>
                        <FormSelect
                          value={designationChoice}
                          onChange={setDesignationChoice}
                          placeholder="Select designation"
                          options={DESIGNATION_OPTIONS}
                          hasError={Boolean(fieldErrors.designation)}
                        />
                        {fieldErrors.designation && (
                          <p className="text-xs text-red-600">{fieldErrors.designation}</p>
                        )}
                      </div>

                      {designationChoice === "Other" && (
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <label htmlFor="staff-custom-designation" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                            Custom Designation <span className="ml-1 text-sky-600">*</span>
                          </label>
                          <input
                            id="staff-custom-designation"
                            type="text"
                            maxLength={100}
                            placeholder="e.g. Front Desk Coordinator"
                            value={designationCustom}
                            onChange={(e) => setDesignationCustom(e.target.value)}
                            className={inputClass(fieldErrors.designation)}
                          />
                          {fieldErrors.designation && (
                            <p className="text-xs text-red-600">{fieldErrors.designation}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Account */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#83909D]">
                      Account
                    </p>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                          Account Role
                        </label>
                        <input
                          type="text"
                          value="Staff"
                          readOnly
                          disabled
                          aria-readonly="true"
                          className="w-full cursor-not-allowed rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#83909D]"
                        />
                        <p className="text-[11px] text-[#83909D]">
                          Only the business owner can hold the administrator role.
                        </p>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                          Account Status <span className="ml-1 text-sky-600">*</span>
                        </label>
                        <FormSelect
                          value={accountStatus}
                          onChange={(v) => setAccountStatus(v as AccountStatus)}
                          options={STATUS_OPTIONS}
                          hasError={Boolean(fieldErrors.accountStatus)}
                        />
                        {fieldErrors.accountStatus && (
                          <p className="text-xs text-red-600">{fieldErrors.accountStatus}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Login Account Setup (new accounts only) */}
                  {modal.kind === "add" && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#83909D]">
                        Login Account Setup
                      </p>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="staff-password" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                            Initial Password <span className="ml-1 text-sky-600">*</span>
                          </label>
                          <PasswordInput
                            id="staff-password"
                            autoComplete="new-password"
                            placeholder="Temporary password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={inputClass(fieldErrors.password)}
                          />
                          {fieldErrors.password && (
                            <p className="text-xs text-red-600">{fieldErrors.password}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="staff-confirm-password" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                            Confirm Initial Password <span className="ml-1 text-sky-600">*</span>
                          </label>
                          <PasswordInput
                            id="staff-confirm-password"
                            autoComplete="new-password"
                            placeholder="Repeat the temporary password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className={inputClass(fieldErrors.confirmPassword)}
                          />
                          {fieldErrors.confirmPassword && (
                            <p className="text-xs text-red-600">{fieldErrors.confirmPassword}</p>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-[#83909D]">
                        Shared with the staff member out-of-band (call/message). It is stored only
                        as a bcrypt hash — never displayed again — and they will be required to
                        change it on first login. There is no email invitation in this app.
                      </p>
                    </div>
                  )}
                  </div>
                ) : (
                  <div className="mt-5">
                    {/* Dashboard Page Permissions — Step 2 */}
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#83909D]">
                      Dashboard Page Permissions
                    </p>
                    <p className="mt-1 text-[11px] text-[#83909D]">
                      Only the pages selected here will be visible and accessible to this staff
                      member. Nothing is granted by default — choose the modules explicitly.
                    </p>
                    <div className="mt-3">
                      <PermissionPicker
                        value={formPermissions}
                        onChange={setFormPermissions}
                        disabled={saving}
                      />
                    </div>
                    {fieldErrors.permissions && (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.permissions}</p>
                    )}
                  </div>
                )}

                {formStep === 1 ? (
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={requestCloseModal}
                      disabled={saving}
                      className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={goToStepTwo}
                      disabled={saving || modalLoading}
                      className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
                    >
                      Next <ArrowRight size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={backToStepOne}
                      disabled={saving}
                      className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
                    >
                      Back
                    </button>
                    <div className="flex flex-wrap justify-end gap-3">
                      <button
                        type="button"
                        onClick={requestCloseModal}
                        disabled={saving}
                        className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submitForm}
                        disabled={saving || modalLoading}
                        className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
                      >
                        {saving
                          ? "Saving..."
                          : modal.kind === "edit"
                            ? "Save Changes"
                            : "Create Staff Account"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------------- View modal ---------------- */}
      {modal && modal.kind === "view" && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="my-6 w-full max-w-lg rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-base font-semibold text-slate-900">Staff Member</h3>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="rounded-lg p-1.5 text-[#83909D] transition hover:bg-[#F1F5F9] hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            {modalLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
              </div>
            ) : modalError || !modalStaff ? (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {modalError ?? "Staff member not found."}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-600">
                    {modalStaff.fullName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {modalStaff.fullName}
                    </p>
                    <p className="truncate text-xs text-[#83909D]">{modalStaff.email}</p>
                  </div>
                </div>

                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    ["Staff ID", modalStaff.staffId],
                    ["Phone Number", modalStaff.phone ?? "—"],
                    ["Designation", modalStaff.designation],
                    ["Role", modalStaff.role === "admin" ? "Administrator" : "Staff"],
                    [
                      "Account Status",
                      modalStaff.accountStatus === "active" ? "Active" : "Inactive",
                    ],
                    [
                      "Password Setup",
                      modalStaff.mustChangePassword
                        ? "Not yet changed by staff"
                        : "Changed by staff",
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-3.5 py-2.5"
                    >
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#83909D]">
                        {label}
                      </dt>
                      <dd className="mt-0.5 truncate text-sm text-[#1E293B]">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#83909D]">
                    Assigned Pages
                  </p>
                  {modalStaff.permissions.length === 0 ? (
                    <p className="mt-1.5 text-sm text-[#5B6B7C]">
                      No pages assigned yet.
                    </p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {permissionLabels(modalStaff.permissions).map((label) => (
                        <span
                          key={label}
                          className="rounded-full border border-sky-600/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-600"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Manage Permissions modal ---------------- */}
      {modal && modal.kind === "permissions" && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="my-6 w-full max-w-3xl rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Manage Permissions</h3>
                <p className="mt-1 text-sm text-[#5B6B7C]">
                  {modalStaff
                    ? `Choose which dashboard pages ${modalStaff.fullName} can access.`
                    : "Choose which dashboard pages this staff member can access."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                aria-label="Close"
                className="rounded-lg p-1.5 text-[#83909D] transition hover:bg-[#F1F5F9] hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            {modalLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
              </div>
            ) : modalError || !modalStaff || managedPermissions === null ? (
              <div className="mt-4">
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {modalError ?? "Staff member not found."}
                </p>
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal(modal)}
                    className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
                  >
                    <RotateCcw size={15} /> Try Again
                  </button>
                </div>
              </div>
            ) : (
              <>
                {submitError && (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {submitError}
                  </p>
                )}
                <div className="mt-4">
                  <PermissionPicker
                    value={managedPermissions}
                    onChange={setManagedPermissions}
                    disabled={saving}
                  />
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={saving}
                    className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={savePermissions}
                    disabled={saving}
                    className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save Permissions"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Activate / Deactivate confirmation ---------------- */}
      {modal && modal.kind === "toggle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">
              {modal.staff.accountStatus === "active" ? "Deactivate Staff" : "Activate Staff"}
            </h3>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              {modal.staff.accountStatus === "active"
                ? `${modal.staff.fullName} will be signed out and blocked from logging in until reactivated. Historical records are kept.`
                : `${modal.staff.fullName} will be able to log in again with their existing password.`}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">{modal.staff.email}</p>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={toggling}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => toggleStatus(modal.staff)}
                disabled={toggling}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                  modal.staff.accountStatus === "active"
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "bg-sky-500 text-slate-900 hover:bg-sky-600"
                }`}
              >
                {toggling
                  ? "Saving..."
                  : modal.staff.accountStatus === "active"
                    ? "Deactivate"
                    : "Activate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Delete Staff confirmation ---------------- */}
      {modal && modal.kind === "delete" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600">
                <Trash2 size={18} />
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                Delete Staff Member?
              </h3>
            </div>
            <p className="mt-3 text-sm text-[#5B6B7C]">
              Are you sure you want to delete this staff member? Their access
              to the dashboard will be revoked. This action cannot be undone.
            </p>
            <p className="mt-2.5 text-sm font-medium text-slate-900">
              {modal.staff.fullName}
            </p>
            <p className="text-xs text-[#83909D]">{modal.staff.email}</p>

            {submitError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {submitError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={deleting}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteStaffMember(modal.staff)}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete Staff"}
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
