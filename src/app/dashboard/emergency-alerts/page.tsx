"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Check,
  CheckCircle2,
  Eye,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Siren,
  X,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import FormSelect from "@/components/dashboard/FormSelect";
import { useAuthMe } from "@/lib/useAuthMe";
import { display } from "@/lib/dashboardFormat";
import {
  ALERT_PRIORITY_LABELS,
  ALERT_PRIORITY_STYLES,
  ALERT_PRIORITIES,
  ALERT_STATUS_LABELS,
  ALERT_STATUS_STYLES,
  ALERT_STATUSES,
  type AlertFieldErrors,
  type AlertStatus,
  type EmergencyAlertItem,
} from "@/lib/emergencyAlerts";

type PatientOption = { id: string; patientCode: string; fullName: string };
type AppointmentOption = {
  id: string;
  appointmentCode: string;
  patientId: string;
  date: string;
  time: string;
};
type ClinicOption = { id: string; clinicName: string; city: string | null };

/** Saved business preferences (Business Settings → System Preferences). */
type SystemPrefs = { dateFormat: string; timeFormat: string };

const ALL = "__all__";

/** Compact filter dropdowns, labels follow the spec's wording. */
const PRIORITY_FILTER_OPTIONS = [
  { value: ALL, label: "Priority: All" },
  ...ALERT_PRIORITIES.map((p) => ({ value: p, label: `Priority: ${ALERT_PRIORITY_LABELS[p]}` })),
];

const STATUS_FILTER_OPTIONS = [
  { value: ALL, label: "Status: All" },
  ...ALERT_STATUSES.map((s) => ({ value: s, label: `Status: ${ALERT_STATUS_LABELS[s]}` })),
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Date rendering honours the business's saved System Preferences
 * (DD/MM/YYYY · MM/DD/YYYY · YYYY-MM-DD) and falls back to the default.
 * Date-only values are built locally so no timezone shift can move a day;
 * timestamps render in the viewer's local time.
 */
function formatDatePref(value: string | null | undefined, prefs: SystemPrefs): string {
  const raw = (value ?? "").trim();
  if (!raw) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  switch (prefs.dateFormat) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "DD/MM/YYYY":
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** "10:30 AM" (12-hour) or "10:30" (24-hour) per saved preferences. */
function formatTimePref(value: string | null | undefined, prefs: SystemPrefs): string {
  const raw = (value ?? "").trim();
  if (!raw) return "—";
  let hour: number;
  let minute: number;
  const timeOnly = /^([01]\d|2[0-3]):([0-5]\d)/.exec(raw);
  if (timeOnly && !raw.includes("T")) {
    hour = Number(timeOnly[1]);
    minute = Number(timeOnly[2]);
  } else {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "—";
    hour = d.getHours();
    minute = d.getMinutes();
  }
  if (prefs.timeFormat === "24-hour") {
    return `${pad2(hour)}:${pad2(minute)}`;
  }
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${pad2(minute)} ${suffix}`;
}

/** Local calendar day ("YYYY-MM-DD") of a timestamp, for the Date filter. */
function dayKey(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The legal next steps for a status (mirrors the server-side workflow). */
type RowAction = {
  to: AlertStatus;
  label: string;
  Icon: typeof Check;
  danger?: boolean;
  /** Dismissing requires an explicit confirmation. */
  confirm?: boolean;
};

function actionsFor(status: AlertStatus): RowAction[] {
  switch (status) {
    case "new":
      return [
        { to: "acknowledged", label: "Acknowledge", Icon: Check },
        { to: "dismissed", label: "Dismiss", Icon: Ban, danger: true, confirm: true },
      ];
    case "acknowledged":
      return [
        { to: "in_progress", label: "Mark In Progress", Icon: Play },
        { to: "resolved", label: "Mark Resolved", Icon: CheckCircle2 },
      ];
    case "in_progress":
      return [{ to: "resolved", label: "Mark Resolved", Icon: CheckCircle2 }];
    default:
      return [];
  }
}

/** Toast wording per completed transition. */
const TOAST_BY_STATUS: Record<AlertStatus, string> = {
  new: "Alert updated.",
  acknowledged: "Alert acknowledged.",
  in_progress: "Alert marked in progress.",
  resolved: "Alert resolved.",
  dismissed: "Alert dismissed.",
};

/**
 * Urgent Dermatology Alerts Log.
 *
 * Every row is a REAL emergency alert loaded live from PostgreSQL through
 * GET /api/emergency-alerts (business-scoped through the JWT). Nothing is
 * hardcoded: patient names and phone numbers come from the EXISTING patient
 * table through JOINs (an alert without a patient shows "—"), alert IDs are
 * generated by the server (ALR-YYYYMMDD-NNNN), and every status change is
 * persisted to PostgreSQL through the workflow API.
 *
 * Search, filters and sorting are pure client-side — no page reloads.
 */
export default function EmergencyAlertsPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [alerts, setAlerts] = useState<EmergencyAlertItem[]>([]);
  const [loading, setLoading] = useState(true); // initial skeleton
  const [refreshing, setRefreshing] = useState(false); // Refresh button spinner
  const [loadFailed, setLoadFailed] = useState(false);
  const busyRef = useRef(false); // blocks duplicate refresh requests

  // Saved date/time preferences (Business Settings → System Preferences).
  const [prefs, setPrefs] = useState<SystemPrefs>({
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12-hour",
  });

  // Create-form dropdown data (real patients/appointments/clinics — never hardcoded).
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [appointments, setAppointments] = useState<AppointmentOption[]>([]);
  const [clinics, setClinics] = useState<ClinicOption[]>([]);

  // Search + filters (client-side only).
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [dateFilter, setDateFilter] = useState("");

  // Create form.
  const [createOpen, setCreateOpen] = useState(false);
  const [createPatient, setCreatePatient] = useState("");
  const [createPriority, setCreatePriority] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [createAppointment, setCreateAppointment] = useState("");
  const [createClinic, setCreateClinic] = useState("");
  const [createErrors, setCreateErrors] = useState<AlertFieldErrors>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // View modal.
  const [viewTarget, setViewTarget] = useState<EmergencyAlertItem | null>(null);
  const [viewNotes, setViewNotes] = useState("");

  // Dismiss confirmation (required before dismissing an alert).
  const [confirmDismiss, setConfirmDismiss] = useState<EmergencyAlertItem | null>(null);

  // Row workflow action (Acknowledge / In Progress / Resolved / Dismiss).
  const [actingId, setActingId] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [toastError, setToastError] = useState(false);

  /** Fetches the LATEST alerts from the backend (never re-serves stale state). */
  const loadAlerts = useCallback(
    async (mode: "initial" | "refresh"): Promise<boolean> => {
      if (busyRef.current) return false; // prevent duplicate refresh requests
      busyRef.current = true;
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setLoadFailed(false);
      try {
        const response = await authFetch("/api/emergency-alerts");
        if (response.status === 401) {
          window.location.href = "/login";
          return false;
        }
        const result = (await response.json()) as {
          data: EmergencyAlertItem[] | null;
          success: boolean;
        };
        if (!response.ok || !result.success || !Array.isArray(result.data)) {
          if (mode === "initial") setAlerts([]);
          setLoadFailed(true);
          return false;
        }
        setAlerts(result.data);
        return true;
      } catch {
        if (mode === "initial") setAlerts([]);
        setLoadFailed(true);
        return false;
      } finally {
        if (mode === "initial") {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
        busyRef.current = false;
      }
    },
    [authFetch]
  );

  /** Patients + appointments + clinics for the create form (existing endpoints). */
  const loadOptions = useCallback(async () => {
    authFetch("/api/patients")
      .then(async (res) => (await res.json()) as { data: Record<string, unknown>[] | null })
      .then((json) => {
        setPatients(
          (json.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            patientCode: String(r.patient_id ?? ""),
            fullName: String(r.full_name ?? ""),
          }))
        );
      })
      .catch(() => setPatients([]));

    authFetch("/api/appointments")
      .then(async (res) => (await res.json()) as { data: Record<string, unknown>[] | null })
      .then((json) => {
        setAppointments(
          (json.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            appointmentCode: String(r.appointmentId ?? ""),
            patientId: String(r.patientId ?? ""),
            date: String(r.appointmentDate ?? ""),
            time: String(r.appointmentTime ?? ""),
          }))
        );
      })
      .catch(() => setAppointments([]));

    authFetch("/api/clinics")
      .then(async (res) => (await res.json()) as { data: Record<string, unknown>[] | null })
      .then((json) => {
        setClinics(
          (json.data ?? []).map((r) => ({
            id: String(r.id ?? ""),
            clinicName: String(r.clinic_name ?? ""),
            city: typeof r.city === "string" ? r.city : null,
          }))
        );
      })
      .catch(() => setClinics([]));
  }, [authFetch]);

  /** Saved system preferences (date/time format) — applied when rendering. */
  const loadPrefs = useCallback(async () => {
    try {
      const response = await authFetch("/api/settings");
      if (!response.ok) return;
      const json = (await response.json()) as {
        data?: { settings?: { systemPrefs?: Partial<SystemPrefs> } } | null;
      };
      const systemPrefs = json.data?.settings?.systemPrefs;
      if (systemPrefs) {
        setPrefs({
          dateFormat: String(systemPrefs.dateFormat ?? "DD/MM/YYYY"),
          timeFormat: String(systemPrefs.timeFormat ?? "12-hour"),
        });
      }
    } catch {
      // Preferences are cosmetic — keep the defaults.
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) {
      loadAlerts("initial");
      loadOptions();
      loadPrefs();
    }
  }, [authLoading, me, loadAlerts, loadOptions, loadPrefs]);

  function showToast(message: string, error = false) {
    setToast(message);
    setToastError(error);
    setTimeout(() => setToast(null), 3500);
  }

  // ---------------- Client-side search + filters ----------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts.filter((a) => {
      if (priorityFilter !== ALL && a.priority !== priorityFilter) return false;
      if (statusFilter !== ALL && a.status !== statusFilter) return false;
      if (dateFilter && dayKey(a.createdAt) !== dateFilter) return false;
      if (q === "") return true;
      return (
        a.alertId.toLowerCase().includes(q) ||
        (a.patientName ?? "").toLowerCase().includes(q) ||
        (a.phone ?? "").toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q)
      );
    });
  }, [alerts, search, priorityFilter, statusFilter, dateFilter]);

  const hasActiveFilters =
    search.trim() !== "" || priorityFilter !== ALL || statusFilter !== ALL || dateFilter !== "";

  // ---------------- Create ----------------
  function openCreate() {
    setCreateOpen(true);
    setCreatePatient("");
    setCreatePriority("");
    setCreateMessage("");
    setCreateAppointment("");
    setCreateClinic("");
    setCreateErrors({});
    setCreateError(null);
  }

  async function submitCreate() {
    if (creating) return; // prevent duplicate submissions
    setCreateErrors({});
    setCreateError(null);

    // Same rules as the server (validateAlert) so the UI matches.
    const errors: AlertFieldErrors = {};
    if (createPriority === "") {
      errors.priority = "Please choose a priority.";
    }
    const message = createMessage.trim();
    if (message === "") {
      errors.message = "Alert message is required.";
    } else if (message.length < 2) {
      errors.message = "Alert message must be at least 2 characters.";
    } else if (message.length > 2000) {
      errors.message = "Alert message must be 2000 characters or fewer.";
    }
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      return;
    }

    setCreating(true);
    try {
      const response = await authFetch("/api/emergency-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: createPatient || null,
          priority: createPriority,
          message,
          appointmentId: createAppointment || null,
          clinicId: createClinic || null,
        }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: (EmergencyAlertItem & { errors?: AlertFieldErrors }) | null;
        success: boolean;
        message: string;
      };

      if (response.ok && result.success && result.data) {
        // Newest first — exactly how GET /api/emergency-alerts orders it.
        setAlerts((prev) => [result.data as EmergencyAlertItem, ...prev]);
        setCreateOpen(false);
        showToast("Emergency alert recorded.");
      } else {
        const fieldErrors = result.data?.errors;
        if (fieldErrors && Object.keys(fieldErrors).length > 0) {
          setCreateErrors(fieldErrors);
        }
        setCreateError(result.message || "Unable to create alert.");
      }
    } catch {
      setCreateError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  // ---------------- View ----------------
  function openView(a: EmergencyAlertItem) {
    setViewTarget(a);
    setViewNotes(a.resolutionNotes ?? "");
  }

  function closeView() {
    setViewTarget(null);
    setViewNotes("");
  }

  // ---------------- Workflow actions ----------------
  async function changeStatus(
    a: EmergencyAlertItem,
    next: AlertStatus,
    resolutionNotes?: string
  ) {
    if (actingId) return; // prevent duplicate action requests
    setActingId(a.id);
    try {
      const response = await authFetch(`/api/emergency-alerts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          resolutionNotes !== undefined ? { status: next, resolutionNotes } : { status: next }
        ),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: EmergencyAlertItem | null;
        success: boolean;
        message: string;
      };
      if (response.ok && result.success && result.data) {
        const updated = result.data;
        setAlerts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        setViewTarget((prev) => (prev && prev.id === updated.id ? updated : prev));
        showToast(TOAST_BY_STATUS[next]);
      } else {
        showToast(result.message || "Unable to update the alert.", true);
      }
    } catch {
      showToast("Could not reach the server.", true);
    } finally {
      setActingId(null);
    }
  }

  // ---------------- Auth loading / error ----------------
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading alerts...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load emergency alerts.</p>
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
  const createAppointmentOptions = appointments
    .filter((a) => createPatient === "" || a.patientId === createPatient)
    .map((a) => ({
      value: a.id,
      label: a.appointmentCode,
      hint: `${formatDatePref(a.date, prefs)} · ${formatTimePref(a.time, prefs)}`,
    }));

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
                🚨 Urgent Dermatology Alerts Log
              </h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Monitor and manage urgent patient alerts and follow-up actions.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openCreate}
                className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition hover:border-[#83909D] hover:text-slate-900"
              >
                <Plus size={16} /> Create Alert
              </button>
              <button
                type="button"
                onClick={() => void loadAlerts("refresh")}
                disabled={refreshing}
                className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:opacity-60"
              >
                {refreshing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RotateCcw size={16} />
                )}
                {refreshing ? "Refreshing..." : "Refresh Alerts"}
              </button>
            </div>
          </div>

          {/* Search + filters — dynamic, never reloads the page */}
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
                placeholder="Search emergency alerts..."
                aria-label="Search emergency alerts"
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] py-2.5 pl-10 pr-4 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
              />
            </div>
            <FormSelect
              className="w-full sm:w-[170px]"
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={PRIORITY_FILTER_OPTIONS}
            />
            <FormSelect
              className="w-full sm:w-[180px]"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTER_OPTIONS}
            />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filter by created date"
              className="min-w-0 rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-3 py-2.5 text-sm text-[#1E293B] outline-none transition focus:border-[#0369A1] [color-scheme:light]"
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setPriorityFilter(ALL);
                  setStatusFilter(ALL);
                  setDateFilter("");
                }}
                className="shrink-0 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-2.5 text-sm text-[#5B6B7C] transition hover:border-[#83909D] hover:text-[#1E293B]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Refresh failure while data is already on screen */}
          {loadFailed && alerts.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-sm font-medium text-red-600">
                Unable to refresh emergency alerts.
              </p>
              <button
                type="button"
                onClick={() => void loadAlerts("refresh")}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:border-red-600 disabled:opacity-60"
              >
                {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                Retry
              </button>
            </div>
          )}

          {/* Content */}
          {loading ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse border-b border-[#E2E8F0] last:border-b-0"
                />
              ))}
            </div>
          ) : loadFailed && alerts.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
                <RotateCcw size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                Unable to load emergency alerts.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">Please try again.</p>
              <button
                type="button"
                onClick={() => void loadAlerts("initial")}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          ) : alerts.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                <Siren size={26} />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-900">
                No emergency alerts yet.
              </p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                New emergency alerts will appear here when they are recorded.
              </p>
              <button
                type="button"
                onClick={openCreate}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <Plus size={16} /> Create Alert
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center">
              <p className="text-sm font-medium text-slate-900">No alerts match your search.</p>
              <p className="mt-1 text-sm text-[#5B6B7C]">
                Try a different alert ID, patient name, phone number or message.
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
              {/* Horizontal scrolling stays INSIDE the table container on mobile. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="divide-x divide-[#E2E8F0]/60 bg-[#EEF2F7] text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5 first:pl-5">
                        Patient
                      </th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">
                        Phone
                      </th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">
                        Priority
                      </th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">
                        Alert Message
                      </th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">
                        Created Date &amp; Time
                      </th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5">
                        Status
                      </th>
                      <th className="whitespace-nowrap border-b border-[#E2E8F0] px-4 py-2.5 text-right last:pr-5">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a) => {
                      const rowActions = actionsFor(a.status);
                      const isActing = actingId === a.id;
                      return (
                        <tr
                          key={a.id}
                          className="divide-x divide-[#E2E8F0]/40 border-b border-[#E2E8F0] transition-colors last:border-b-0 hover:bg-[#E8EEF4]"
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium leading-tight text-[#1E293B]">
                              {display(a.patientName)}
                            </p>
                            {a.patientCode && (
                              <p className="mt-0.5 text-[11px] leading-tight text-[#83909D]">
                                {a.patientCode}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#5B6B7C]">
                            {display(a.phone)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ALERT_PRIORITY_STYLES[a.priority]}`}
                            >
                              {ALERT_PRIORITY_LABELS[a.priority]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {/* Long messages truncate neatly; click (or View) shows the full text. */}
                            <button
                              type="button"
                              onClick={() => openView(a)}
                              title={a.message}
                              className="block max-w-[280px] truncate text-left text-[#5B6B7C] transition hover:text-[#0369A1]"
                            >
                              {a.message}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#5B6B7C]">
                            {formatDatePref(a.createdAt, prefs)} ·{" "}
                            {formatTimePref(a.createdAt, prefs)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ALERT_STATUS_STYLES[a.status]}`}
                            >
                              {ALERT_STATUS_LABELS[a.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 last:pr-5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openView(a)}
                                title="View alert details"
                                aria-label="View alert details"
                                className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-xs font-medium text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
                              >
                                <Eye size={13} /> View Details
                              </button>
                              {isActing ? (
                                <span
                                  title="Updating..."
                                  className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] px-2 py-1.5 text-xs font-medium text-[#83909D]"
                                >
                                  <Loader2 size={13} className="animate-spin" />
                                  Updating...
                                </span>
                              ) : (
                                rowActions.map(({ to, label, Icon, danger, confirm }) => (
                                  <button
                                    key={to}
                                    type="button"
                                    onClick={() => {
                                      if (confirm) {
                                        setConfirmDismiss(a);
                                      } else {
                                        void changeStatus(a, to);
                                      }
                                    }}
                                    title={label}
                                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                                      danger
                                        ? "border-[#E2E8F0] text-[#5B6B7C] hover:border-red-600 hover:text-red-600"
                                        : "border-[#E2E8F0] text-[#5B6B7C] hover:border-[#0369A1] hover:text-[#0369A1]"
                                    }`}
                                  >
                                    <Icon size={13} /> {label}
                                  </button>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create alert modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h3 className="text-base font-semibold text-slate-900">Create Emergency Alert</h3>
            <p className="mt-1 text-sm text-[#5B6B7C]">
              The alert ID is generated automatically (ALR-YYYYMMDD-NNNN) and the patient is
              selected from your existing records — never duplicated.
            </p>

            {createError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {createError}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Patient <span className="text-[#83909D]">(optional)</span>
                </label>
                <FormSelect
                  value={createPatient}
                  onChange={(v) => {
                    setCreatePatient(v);
                    setCreateAppointment("");
                    setCreateErrors((prev) => ({ ...prev, patientId: undefined }));
                  }}
                  placeholder="No patient (general alert)"
                  hasError={Boolean(createErrors.patientId)}
                  options={[
                    { value: "", label: "No patient (general alert)" },
                    ...patients.map((p) => ({
                      value: p.id,
                      label: p.fullName,
                      hint: p.patientCode,
                    })),
                  ]}
                />
                {createErrors.patientId && (
                  <p className="text-xs text-red-600">{createErrors.patientId}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Priority <span className="ml-1 text-sky-600">*</span>
                </label>
                <FormSelect
                  value={createPriority}
                  onChange={(v) => {
                    setCreatePriority(v);
                    setCreateErrors((prev) => ({ ...prev, priority: undefined }));
                  }}
                  placeholder="Select priority"
                  hasError={Boolean(createErrors.priority)}
                  options={ALERT_PRIORITIES.map((p) => ({
                    value: p,
                    label: ALERT_PRIORITY_LABELS[p],
                  }))}
                />
                {createErrors.priority && (
                  <p className="text-xs text-red-600">{createErrors.priority}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Alert Message <span className="ml-1 text-sky-600">*</span>
                </label>
                <textarea
                  value={createMessage}
                  onChange={(e) => {
                    setCreateMessage(e.target.value);
                    setCreateErrors((prev) => ({ ...prev, message: undefined }));
                  }}
                  rows={4}
                  placeholder="Describe the emergency..."
                  className={`resize-none rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20 ${
                    createErrors.message ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {createErrors.message && (
                  <p className="text-xs text-red-600">{createErrors.message}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Related Appointment <span className="text-[#83909D]">(optional)</span>
                </label>
                <FormSelect
                  value={createAppointment}
                  onChange={setCreateAppointment}
                  placeholder="No appointment"
                  hasError={Boolean(createErrors.appointmentId)}
                  options={[{ value: "", label: "No appointment" }, ...createAppointmentOptions]}
                />
                {createErrors.appointmentId && (
                  <p className="text-xs text-red-600">{createErrors.appointmentId}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Related Clinic <span className="text-[#83909D]">(optional)</span>
                </label>
                <FormSelect
                  value={createClinic}
                  onChange={setCreateClinic}
                  placeholder="No clinic"
                  hasError={Boolean(createErrors.clinicId)}
                  options={[
                    { value: "", label: "No clinic" },
                    ...clinics.map((c) => ({
                      value: c.id,
                      label: c.clinicName,
                      hint: c.city ?? undefined,
                    })),
                  ]}
                />
                {createErrors.clinicId && (
                  <p className="text-xs text-red-600">{createErrors.clinicId}</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitCreate()}
                disabled={creating}
                className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
              >
                {creating ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Plus size={15} />
                )}
                {creating ? "Creating..." : "Create Alert"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View alert details modal */}
      {viewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]">
            <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-6 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-slate-900">
                  Emergency Alert Details
                </h3>
                <p className="mt-0.5 font-mono text-xs text-[#83909D]">
                  {viewTarget.alertId}
                </p>
              </div>
              <button
                type="button"
                onClick={closeView}
                title="Close"
                aria-label="Close alert details"
                className="shrink-0 rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-[#0369A1] hover:text-[#0369A1]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 overflow-y-auto px-6 py-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                  Alert ID
                </p>
                <p className="mt-0.5 font-mono text-sm font-medium text-[#1E293B]">
                  {viewTarget.alertId}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                  Status
                </p>
                <p className="mt-1">
                  <span
                    className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ALERT_STATUS_STYLES[viewTarget.status]}`}
                  >
                    {ALERT_STATUS_LABELS[viewTarget.status]}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                  Patient Name
                </p>
                <p className="mt-0.5 text-sm font-medium text-[#1E293B]">
                  {display(viewTarget.patientName)}
                  {viewTarget.patientCode ? (
                    <span className="ml-2 font-mono text-xs text-[#83909D]">
                      {viewTarget.patientCode}
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                  Patient Phone
                </p>
                <p className="mt-0.5 text-sm font-medium text-[#1E293B]">
                  {display(viewTarget.phone)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                  Priority
                </p>
                <p className="mt-1">
                  <span
                    className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ALERT_PRIORITY_STYLES[viewTarget.priority]}`}
                  >
                    {ALERT_PRIORITY_LABELS[viewTarget.priority]}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                  Created Date &amp; Time
                </p>
                <p className="mt-0.5 text-sm font-medium text-[#1E293B]">
                  {formatDatePref(viewTarget.createdAt, prefs)} ·{" "}
                  {formatTimePref(viewTarget.createdAt, prefs)}
                </p>
              </div>

              <div className="sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                  Alert Message
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-[#1E293B]">
                  {viewTarget.message}
                </p>
              </div>

              {/* Only shown when the data ACTUALLY exists in the database. */}
              {viewTarget.appointmentCode && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                    Related Appointment
                  </p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-[#1E293B]">
                    {viewTarget.appointmentCode}
                    {viewTarget.appointmentDate ? (
                      <span className="ml-2 font-sans text-xs text-[#5B6B7C]">
                        {formatDatePref(viewTarget.appointmentDate, prefs)}
                        {viewTarget.appointmentTime
                          ? ` · ${formatTimePref(viewTarget.appointmentTime, prefs)}`
                          : ""}
                      </span>
                    ) : null}
                  </p>
                </div>
              )}
              {viewTarget.clinicName && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                    Related Clinic
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-[#1E293B]">
                    {viewTarget.clinicName}
                  </p>
                </div>
              )}
              {viewTarget.resolvedAt && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                    Resolved Date &amp; Time
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-[#1E293B]">
                    {formatDatePref(viewTarget.resolvedAt, prefs)} ·{" "}
                    {formatTimePref(viewTarget.resolvedAt, prefs)}
                  </p>
                </div>
              )}

              {/* Resolution notes: editable while the workflow can still reach
                  Resolved; read-only once stored. */}
              {(viewTarget.status === "acknowledged" ||
                viewTarget.status === "in_progress") && (
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                    Resolution Notes <span className="normal-case">(optional)</span>
                  </label>
                  <textarea
                    value={viewNotes}
                    onChange={(e) => setViewNotes(e.target.value)}
                    rows={2}
                    placeholder="Notes saved when the alert is resolved..."
                    className="mt-1 resize-none rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
                  />
                </div>
              )}
              {viewTarget.resolutionNotes &&
                viewTarget.status !== "acknowledged" &&
                viewTarget.status !== "in_progress" && (
                  <div className="sm:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#83909D]">
                      Resolution Notes
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-[#1E293B]">
                      {viewTarget.resolutionNotes}
                    </p>
                  </div>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#E2E8F0] px-6 py-4">
              {actingId === viewTarget.id ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm font-medium text-[#83909D]">
                  <Loader2 size={14} className="animate-spin" /> Updating...
                </span>
              ) : (
                actionsFor(viewTarget.status).map(({ to, label, Icon, danger, confirm }) => (
                  <button
                    key={to}
                    type="button"
                    onClick={() => {
                      if (confirm) {
                        setConfirmDismiss(viewTarget);
                      } else {
                        void changeStatus(
                          viewTarget,
                          to,
                          to === "resolved" ? viewNotes.trim() : undefined
                        );
                      }
                    }}
                    className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                      danger
                        ? "border-[#E2E8F0] text-[#5B6B7C] hover:border-red-600 hover:text-red-600"
                        : "border-[#E2E8F0] text-[#5B6B7C] hover:border-[#0369A1] hover:text-[#0369A1]"
                    }`}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={closeView}
                className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss confirmation (required before dismissing) */}
      {confirmDismiss && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <h4 className="text-base font-semibold text-slate-900">Dismiss this alert?</h4>
            <p className="mt-2 text-sm text-[#5B6B7C]">
              The alert will be marked as dismissed and leave the active workflow. You can
              still view it afterwards.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDismiss(null)}
                disabled={actingId !== null}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = confirmDismiss;
                  setConfirmDismiss(null);
                  void changeStatus(target, "dismissed");
                }}
                disabled={actingId !== null}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                <Ban size={15} /> Dismiss Alert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success / error toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border bg-[#FFFFFF] px-4 py-3 shadow-xl ${
            toastError ? "border-red-600/30" : "border-sky-600/30"
          }`}
        >
          {toastError ? (
            <X size={18} className="text-red-600" />
          ) : (
            <CheckCircle2 size={18} className="text-sky-600" />
          )}
          <p className="text-sm font-medium text-slate-900">{toast}</p>
        </div>
      )}
    </div>
  );
}
