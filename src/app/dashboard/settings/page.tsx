"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  Clock3,
  Globe,
  KeyRound,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Bell,
  Image as ImageIcon,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import { useAuthMe } from "@/lib/useAuthMe";
import {
  validateBusinessSettings,
  type BusinessSettingsFieldErrors,
  NOTIFICATION_KEYS,
  APPOINTMENT_DURATIONS,
  APPOINTMENT_STATUSES,
  DATE_FORMATS,
  TIME_FORMATS,
  TIME_ZONES,
} from "@/lib/settingsValidation";

/**
 * Global settings for the authenticated business (GET/PATCH /api/settings).
 *
 * Sections: Clinic/Business Settings, Notifications, Appointment
 * Preferences, Security and System Preferences. Personal profile fields live
 * on the Profile page; clinic locations/schedules remain separate features.
 */

type BusinessData = {
  businessName: string;
  email: string | null;
  contactNumber: string | null;
  logoUrl: string | null;
  fullAddress: string | null;
  city: string | null;
  cityCode: string | null;
  googleMapsUrl: string | null;
};

type SettingsData = {
  notifications: Record<string, boolean>;
  appointmentPrefs: {
    defaultDuration: number;
    allowSameDay: boolean;
    allowCancellation: boolean;
    defaultStatus: string;
  };
  systemPrefs: {
    dateFormat: string;
    timeFormat: string;
    timeZone: string;
    language: string;
  };
};

type SettingsResponse = {
  data: { business: BusinessData; settings: SettingsData } | null;
  success: boolean;
  message?: string;
};

const NOTIFICATION_LABELS: Record<string, string> = {
  newAppointment: "New Appointment Notifications",
  appointmentCancellation: "Appointment Cancellation Notifications",
  appointmentReminder: "Appointment Reminder",
  newPatient: "New Patient Notifications",
  system: "System Notifications",
  email: "Email Notifications",
};

const NOTIFICATION_HINTS: Record<string, string> = {
  newAppointment: "Get notified whenever a new appointment is booked.",
  appointmentCancellation: "Get notified when an appointment is cancelled.",
  appointmentReminder: "Send reminders before upcoming appointments.",
  newPatient: "Get notified when a new patient is registered.",
  system: "Important system and account alerts.",
  email: "Also receive these notifications by email.",
};

const EMPTY_PASSWORDS = { currentPassword: "", newPassword: "", confirmPassword: "" };

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Logos are resized to this square (JPEG q0.85, like photos) before saving. */
const LOGO_SIZE = 512;

async function resizeToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the image."));
      img.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = LOGO_SIZE;
    canvas.height = LOGO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the image.");

    const side = Math.min(image.width, image.height);
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    ctx.drawImage(image, sx, sy, side, side, 0, 0, LOGO_SIZE, LOGO_SIZE);

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function SettingsPage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ---- Loaded data ----
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // ---- Clinic / business settings ----
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [businessForm, setBusinessForm] = useState({
    businessName: "",
    email: "",
    contactNumber: "",
    logoUrl: "",
    fullAddress: "",
    city: "",
    cityCode: "",
    googleMapsUrl: "",
  });
  const [businessErrors, setBusinessErrors] = useState<BusinessSettingsFieldErrors>({});
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [businessNotice, setBusinessNotice] = useState<string | null>(null);
  const [businessFormError, setBusinessFormError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoResizing, setLogoResizing] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // ---- Preference groups (persisted via PATCH /api/settings) ----
  const [notifications, setNotifications] = useState<Record<string, boolean>>({});
  const [apptPrefs, setApptPrefs] = useState({
    defaultDuration: 30,
    allowSameDay: true,
    allowCancellation: true,
    defaultStatus: "scheduled",
  });
  const [systemPrefs, setSystemPrefs] = useState({
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12-hour",
    timeZone: "Asia/Karachi",
    language: "English",
  });
  const [savingPrefs, setSavingPrefs] = useState<string | null>(null);
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  // ---- Security (change password lives here too, per Settings spec) ----
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await authFetch("/api/settings");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as SettingsResponse;
      if (!response.ok || !result.success || !result.data) {
        setLoadError(true);
        return;
      }
      const b = result.data.business;
      setBusiness(b);
      setBusinessForm({
        businessName: b.businessName ?? "",
        email: b.email ?? "",
        contactNumber: b.contactNumber ?? "",
        logoUrl: b.logoUrl ?? "",
        fullAddress: b.fullAddress ?? "",
        city: b.city ?? "",
        cityCode: b.cityCode ?? "",
        googleMapsUrl: b.googleMapsUrl ?? "",
      });
      setNotifications(result.data.settings.notifications);
      setApptPrefs(result.data.settings.appointmentPrefs);
      setSystemPrefs(result.data.settings.systemPrefs);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) loadSettings();
  }, [authLoading, me, loadSettings]);

  function showToast(setter: (v: string | null) => void, message: string) {
    setter(message);
    setTimeout(() => setter(null), 3500);
  }

  // ---- Logo upload / replace / remove ----
  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLogoError("Accepts JPG, PNG, WEBP only.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setLogoError("Image is too large (max 10MB).");
      return;
    }
    setLogoResizing(true);
    try {
      const dataUrl = await resizeToDataUrl(file);
      setBusinessForm((p) => ({ ...p, logoUrl: dataUrl }));
    } catch {
      setLogoError("Could not process this image. Please try another one.");
    } finally {
      setLogoResizing(false);
    }
  }

  function removeLogo() {
    setLogoError(null);
    setBusinessForm((p) => ({ ...p, logoUrl: "" }));
    if (logoInputRef.current) logoInputRef.current.value = "";
  }

  // ---- Save clinic/business settings ----
  async function handleBusinessSave(e: React.FormEvent) {
    e.preventDefault();
    if (savingBusiness || logoResizing) return; // prevent duplicate submissions

    const result = validateBusinessSettings(businessForm);
    if (!result.ok) {
      setBusinessErrors(result.errors);
      return;
    }
    setBusinessErrors({});
    setBusinessFormError(null);
    setSavingBusiness(true);
    try {
      const response = await authFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business: result.data }),
      });
      const res = (await response.json()) as SettingsResponse & {
        data?: { errors?: Record<string, string> } | null;
      };
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok || !res.success) {
        if (response.status === 400 && res.data && "errors" in res.data && res.data.errors) {
          setBusinessErrors(res.data.errors as BusinessSettingsFieldErrors);
        }
        setBusinessFormError(res.message ?? "Unable to save settings.");
        return;
      }
      const b = res.data!.business;
      setBusiness(b);
      setBusinessForm({
        businessName: b.businessName ?? "",
        email: b.email ?? "",
        contactNumber: b.contactNumber ?? "",
        logoUrl: b.logoUrl ?? "",
        fullAddress: b.fullAddress ?? "",
        city: b.city ?? "",
        cityCode: b.cityCode ?? "",
        googleMapsUrl: b.googleMapsUrl ?? "",
      });
      showToast(setBusinessNotice, "Clinic settings saved successfully.");
    } catch {
      setBusinessFormError("Could not reach the server. Please try again.");
    } finally {
      setSavingBusiness(false);
    }
  }

  // ---- Save a preference group ----
  async function savePrefsGroup(group: "notifications" | "appointmentPrefs" | "systemPrefs") {
    if (savingPrefs) return; // prevent duplicate submissions
    setPrefsError(null);
    setSavingPrefs(group);
    try {
      const payload =
        group === "notifications"
          ? { settings: { notifications } }
          : group === "appointmentPrefs"
            ? { settings: { appointmentPrefs: apptPrefs } }
            : { settings: { systemPrefs } };
      const response = await authFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = (await response.json()) as SettingsResponse;
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok || !res.success) {
        setPrefsError(res.message ?? "Unable to save this setting.");
        return;
      }
      showToast(setPrefsNotice, "Setting saved.");
    } catch {
      setPrefsError("Could not reach the server. Please try again.");
    } finally {
      setSavingPrefs(null);
    }
  }

  // ---- Change password (Security section) ----
  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    if (savingPassword) return;
    setPasswordFormError(null);

    // Reuse the same client-side rules as the Profile page.
    if (!passwords.currentPassword) {
      setPasswordErrors({ currentPassword: "Current password is required." });
      return;
    }
    if (!passwords.newPassword) {
      setPasswordErrors({ newPassword: "New password is required." });
      return;
    }
    if (passwords.newPassword.length < 8) {
      setPasswordErrors({ newPassword: "New password must be at least 8 characters." });
      return;
    }
    if (!passwords.confirmPassword) {
      setPasswordErrors({ confirmPassword: "Please confirm the new password." });
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordErrors({ confirmPassword: "New password and confirmation do not match." });
      return;
    }

    setPasswordErrors({});
    setSavingPassword(true);
    try {
      const response = await authFetch("/api/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwords),
      });
      const res = (await response.json()) as {
        data: { errors?: Record<string, string> } | null;
        success: boolean;
        message?: string;
      };
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok || !res.success) {
        if (response.status === 400 && res.data && "errors" in res.data && res.data.errors) {
          setPasswordErrors(res.data.errors as Record<string, string>);
        }
        setPasswordFormError(res.message ?? "Unable to change the password.");
        return;
      }
      setPasswords(EMPTY_PASSWORDS);
      showToast(setPasswordNotice, "Password changed successfully.");
    } catch {
      setPasswordFormError("Could not reach the server. Please try again.");
    } finally {
      setSavingPassword(false);
    }
  }

  // ---------------- Loading / error states ----------------
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load settings.</p>
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

  const inputClass = (hasError: boolean) =>
    `w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder-[#83909D] outline-none transition-colors ${
      hasError
        ? "border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
        : "border-[#E2E8F0] focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/15"
    }`;

  const selectClass = (hasError: boolean) => inputClass(hasError);

  function Field({
    label,
    error,
    children,
    span2 = false,
  }: {
    label: string;
    error?: string;
    children: React.ReactNode;
    span2?: boolean;
  }) {
    return (
      <div className={span2 ? "sm:col-span-2" : undefined}>
        <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">{label}</label>
        {children}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  function Toggle({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
  }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-sky-500" : "bg-[#E2E8F0]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[1.375rem]" : "left-0.5"
          }`}
        />
      </button>
    );
  }

  function PrefSaveButton({ group, label }: { group: "notifications" | "appointmentPrefs" | "systemPrefs"; label: string }) {
    const saving = savingPrefs === group;
    return (
      <div className="flex items-center justify-end border-t border-[#E2E8F0] pt-5">
        <button
          type="button"
          onClick={() => void savePrefsGroup(group)}
          disabled={savingPrefs !== null}
          className="flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save size={14} /> {saving ? "Saving..." : label}
        </button>
      </div>
    );
  }

  function SectionHeader({
    icon: Icon,
    title,
    subtitle,
  }: {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    title: string;
    subtitle: string;
  }) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600">
          <Icon size={17} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-[#83909D]">{subtitle}</p>
        </div>
      </div>
    );
  }

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
              <Link
                href="/dashboard"
                className="mb-2 inline-flex items-center gap-1.5 text-sm text-[#5B6B7C] transition-colors hover:text-sky-600"
              >
                <ArrowLeft size={14} /> Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Clinic configuration, notifications and global preferences.
              </p>
            </div>
            <span className="rounded-full border border-sky-600/30 bg-sky-500/10 px-3.5 py-1.5 text-sm font-semibold text-sky-600">
              {businessName}
            </span>
          </div>

          {loading ? (
            <div className="mt-6 space-y-4">
              <div className="h-64 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]" />
              <div className="h-64 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]" />
            </div>
          ) : loadError ? (
            <div className="mt-6 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-10 text-center">
              <p className="text-sm text-[#5B6B7C]">Unable to load settings.</p>
              <button
                type="button"
                onClick={loadSettings}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {/* ============ 1. Clinic / Business Settings ============ */}
              <form
                onSubmit={handleBusinessSave}
                className="space-y-5 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6"
              >
                <SectionHeader
                  icon={Building2}
                  title="Clinic / Business Settings"
                  subtitle="Basic details for your clinic or business."
                />

                {/* Logo */}
                <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                  <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#F1F5F9]">
                    {businessForm.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={businessForm.logoUrl} alt="Clinic logo" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-sky-500/10 text-sky-600">
                        <ImageIcon size={30} />
                      </div>
                    )}
                    {logoResizing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2 text-xs font-semibold text-[#0369A1] transition-colors hover:border-sky-500/40 hover:text-sky-600"
                    >
                      <Camera size={14} /> {businessForm.logoUrl ? "Replace Logo" : "Upload Logo"}
                    </button>
                    {businessForm.logoUrl && (
                      <button
                        type="button"
                        onClick={removeLogo}
                        className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20"
                      >
                        <Trash2 size={14} /> Remove Logo
                      </button>
                    )}
                    <p className="w-full text-[11px] text-[#83909D]">
                      Accepts JPG, PNG, WEBP. The logo is stored with your business in PostgreSQL.
                    </p>
                  </div>
                </div>
                {logoError && <p className="text-xs text-red-600">{logoError}</p>}
                {businessErrors.logoUrl && <p className="text-xs text-red-600">{businessErrors.logoUrl}</p>}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => void handleLogoFile(e.target.files?.[0])}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Clinic / Business Name" error={businessErrors.businessName}>
                    <input
                      type="text"
                      value={businessForm.businessName}
                      onChange={(e) => {
                        setBusinessForm((p) => ({ ...p, businessName: e.target.value }));
                        setBusinessErrors((p) => ({ ...p, businessName: undefined }));
                      }}
                      placeholder="e.g. Dermacare Clinic"
                      maxLength={255}
                      className={inputClass(!!businessErrors.businessName)}
                    />
                  </Field>

                  <Field
                    label="Business Email"
                    error={businessErrors.email}
                  >
                    {/* The business email IS the signup/login email — shown
                        read-only; changes happen via Profile → Email. */}
                    <input
                      type="email"
                      value={businessForm.email}
                      readOnly
                      title="This is your login email — change it on the Profile page."
                      className={`${inputClass(false)} cursor-not-allowed opacity-70`}
                    />
                  </Field>

                  <Field label="Contact Number" error={businessErrors.contactNumber}>
                    <input
                      type="tel"
                      value={businessForm.contactNumber}
                      onChange={(e) => {
                        setBusinessForm((p) => ({ ...p, contactNumber: e.target.value }));
                        setBusinessErrors((p) => ({ ...p, contactNumber: undefined }));
                      }}
                      placeholder="+92 300 1234567"
                      maxLength={30}
                      className={inputClass(!!businessErrors.contactNumber)}
                    />
                  </Field>

                  <Field label="City" error={businessErrors.city}>
                    <input
                      type="text"
                      value={businessForm.city}
                      onChange={(e) => {
                        setBusinessForm((p) => ({ ...p, city: e.target.value }));
                        setBusinessErrors((p) => ({ ...p, city: undefined }));
                      }}
                      placeholder="e.g. Karachi"
                      maxLength={100}
                      className={inputClass(!!businessErrors.city)}
                    />
                  </Field>

                  <Field label="City Code" error={businessErrors.cityCode}>
                    <input
                      type="text"
                      value={businessForm.cityCode}
                      onChange={(e) => {
                        setBusinessForm((p) => ({ ...p, cityCode: e.target.value }));
                        setBusinessErrors((p) => ({ ...p, cityCode: undefined }));
                      }}
                      placeholder="e.g. KHI-01"
                      maxLength={50}
                      className={inputClass(!!businessErrors.cityCode)}
                    />
                  </Field>

                  <Field label="Google Maps URL" error={businessErrors.googleMapsUrl}>
                    <input
                      type="url"
                      value={businessForm.googleMapsUrl}
                      onChange={(e) => {
                        setBusinessForm((p) => ({ ...p, googleMapsUrl: e.target.value }));
                        setBusinessErrors((p) => ({ ...p, googleMapsUrl: undefined }));
                      }}
                      placeholder="https://maps.google.com/..."
                      maxLength={1000}
                      className={inputClass(!!businessErrors.googleMapsUrl)}
                    />
                  </Field>

                  <Field label="Full Address" error={businessErrors.fullAddress} span2>
                    <textarea
                      value={businessForm.fullAddress}
                      onChange={(e) => {
                        setBusinessForm((p) => ({ ...p, fullAddress: e.target.value }));
                        setBusinessErrors((p) => ({ ...p, fullAddress: undefined }));
                      }}
                      placeholder="Street, area, landmark..."
                      rows={2}
                      maxLength={500}
                      className={`${inputClass(!!businessErrors.fullAddress)} resize-y`}
                    />
                  </Field>
                </div>

                {businessFormError && (
                  <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-600">
                    {businessFormError}
                  </p>
                )}

                <div className="flex items-center justify-end border-t border-[#E2E8F0] pt-5">
                  <button
                    type="submit"
                    disabled={savingBusiness || logoResizing}
                    className="rounded-xl bg-sky-500 px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingBusiness ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              {/* ============ 2. Notifications ============ */}
              <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6">
                <SectionHeader
                  icon={Bell}
                  title="Notification Settings"
                  subtitle="Choose which events generate notifications."
                />
                <div className="mt-5 divide-y divide-[#E2E8F0] rounded-xl border border-[#E2E8F0]">
                  {NOTIFICATION_KEYS.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-4 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-900">{NOTIFICATION_LABELS[key]}</p>
                        <p className="mt-0.5 text-xs text-[#83909D]">{NOTIFICATION_HINTS[key]}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className={`text-xs font-semibold ${notifications[key] ? "text-sky-600" : "text-[#83909D]"}`}>
                          {notifications[key] ? "ON" : "OFF"}
                        </span>
                        <Toggle
                          checked={!!notifications[key]}
                          onChange={(v) => setNotifications((p) => ({ ...p, [key]: v }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {prefsError && (
                  <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-600">
                    {prefsError}
                  </p>
                )}
                <div className="mt-5">
                  <PrefSaveButton group="notifications" label="Save Notifications" />
                </div>
              </section>

              <div className="grid gap-6 xl:grid-cols-2">
                {/* ============ 3. Appointment Preferences ============ */}
                <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6">
                  <SectionHeader
                    icon={Clock3}
                    title="Appointment Preferences"
                    subtitle="Defaults applied to new appointments."
                  />
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label="Default Appointment Duration">
                      <select
                        value={apptPrefs.defaultDuration}
                        onChange={(e) => setApptPrefs((p) => ({ ...p, defaultDuration: Number(e.target.value) }))}
                        className={selectClass(false)}
                      >
                        {APPOINTMENT_DURATIONS.map((d) => (
                          <option key={d} value={d} className="bg-[#F1F5F9]">
                            {d} minutes
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Default Appointment Status">
                      <select
                        value={apptPrefs.defaultStatus}
                        onChange={(e) => setApptPrefs((p) => ({ ...p, defaultStatus: e.target.value }))}
                        className={selectClass(false)}
                      >
                        {APPOINTMENT_STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-[#F1F5F9]">
                            {s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#E2E8F0] px-4 py-3 sm:col-span-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-900">Allow Same-Day Appointments</p>
                        <p className="mt-0.5 text-xs text-[#83909D]">Patients can book appointments for today.</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className={`text-xs font-semibold ${apptPrefs.allowSameDay ? "text-sky-600" : "text-[#83909D]"}`}>
                          {apptPrefs.allowSameDay ? "ON" : "OFF"}
                        </span>
                        <Toggle
                          checked={apptPrefs.allowSameDay}
                          onChange={(v) => setApptPrefs((p) => ({ ...p, allowSameDay: v }))}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#E2E8F0] px-4 py-3 sm:col-span-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-900">Allow Appointment Cancellation</p>
                        <p className="mt-0.5 text-xs text-[#83909D]">Appointments can be cancelled before their time.</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className={`text-xs font-semibold ${apptPrefs.allowCancellation ? "text-sky-600" : "text-[#83909D]"}`}>
                          {apptPrefs.allowCancellation ? "ON" : "OFF"}
                        </span>
                        <Toggle
                          checked={apptPrefs.allowCancellation}
                          onChange={(v) => setApptPrefs((p) => ({ ...p, allowCancellation: v }))}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-5">
                    <PrefSaveButton group="appointmentPrefs" label="Save Preferences" />
                  </div>
                </section>

                {/* ============ 4. System Preferences ============ */}
                <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6">
                  <SectionHeader
                    icon={Globe}
                    title="System Preferences"
                    subtitle="Date, time, timezone and language defaults."
                  />
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label="Date Format">
                      <select
                        value={systemPrefs.dateFormat}
                        onChange={(e) => setSystemPrefs((p) => ({ ...p, dateFormat: e.target.value }))}
                        className={selectClass(false)}
                      >
                        {DATE_FORMATS.map((f) => (
                          <option key={f} value={f} className="bg-[#F1F5F9]">
                            {f}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Time Format">
                      <select
                        value={systemPrefs.timeFormat}
                        onChange={(e) => setSystemPrefs((p) => ({ ...p, timeFormat: e.target.value }))}
                        className={selectClass(false)}
                      >
                        {TIME_FORMATS.map((f) => (
                          <option key={f} value={f} className="bg-[#F1F5F9]">
                            {f}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Time Zone">
                      <select
                        value={systemPrefs.timeZone}
                        onChange={(e) => setSystemPrefs((p) => ({ ...p, timeZone: e.target.value }))}
                        className={selectClass(false)}
                      >
                        {TIME_ZONES.map((tz) => (
                          <option key={tz} value={tz} className="bg-[#F1F5F9]">
                            {tz}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Language">
                      <select
                        value={systemPrefs.language}
                        onChange={(e) => setSystemPrefs((p) => ({ ...p, language: e.target.value }))}
                        className={selectClass(false)}
                      >
                        <option value="English" className="bg-[#F1F5F9]">English</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-5">
                    <PrefSaveButton group="systemPrefs" label="Save Preferences" />
                  </div>
                </section>
              </div>

              {/* ============ 5. Security ============ */}
              <section className="rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6">
                <SectionHeader
                  icon={ShieldCheck}
                  title="Security"
                  subtitle="Protect your account with a strong, unique password."
                />
                <div className="mt-5 grid gap-6 xl:grid-cols-2">
                  <form onSubmit={handlePasswordSave} className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">Current Password</label>
                      <input
                        type="password"
                        value={passwords.currentPassword}
                        onChange={(e) => {
                          setPasswords((p) => ({ ...p, currentPassword: e.target.value }));
                          setPasswordErrors((p) => ({ ...p, currentPassword: "" }));
                        }}
                        placeholder="Enter your current password"
                        autoComplete="current-password"
                        className={inputClass(!!passwordErrors.currentPassword)}
                      />
                      {passwordErrors.currentPassword && (
                        <p className="mt-1 text-xs text-red-600">{passwordErrors.currentPassword}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">New Password</label>
                      <input
                        type="password"
                        value={passwords.newPassword}
                        onChange={(e) => {
                          setPasswords((p) => ({ ...p, newPassword: e.target.value }));
                          setPasswordErrors((p) => ({ ...p, newPassword: "" }));
                        }}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        className={inputClass(!!passwordErrors.newPassword)}
                      />
                      {passwordErrors.newPassword && (
                        <p className="mt-1 text-xs text-red-600">{passwordErrors.newPassword}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">Confirm New Password</label>
                      <input
                        type="password"
                        value={passwords.confirmPassword}
                        onChange={(e) => {
                          setPasswords((p) => ({ ...p, confirmPassword: e.target.value }));
                          setPasswordErrors((p) => ({ ...p, confirmPassword: "" }));
                        }}
                        placeholder="Re-enter the new password"
                        autoComplete="new-password"
                        className={inputClass(!!passwordErrors.confirmPassword)}
                      />
                      {passwordErrors.confirmPassword && (
                        <p className="mt-1 text-xs text-red-600">{passwordErrors.confirmPassword}</p>
                      )}
                    </div>

                    {passwordFormError && (
                      <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-600">
                        {passwordFormError}
                      </p>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingPassword}
                        className="flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <KeyRound size={14} /> {savingPassword ? "Updating..." : "Update Password"}
                      </button>
                    </div>
                  </form>

                  {/* Security information */}
                  <div className="space-y-3 self-start rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] p-4">
                    <div className="flex items-center gap-2.5">
                      <SlidersHorizontal size={14} className="text-sky-600" />
                      <p className="text-sm font-medium text-slate-900">How your account is protected</p>
                    </div>
                    <ul className="space-y-2.5 text-xs leading-relaxed text-[#5B6B7C]">
                      <li className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                        Passwords are stored only as bcrypt hashes — plain-text passwords are never kept or shown.
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                        Sessions use signed, expiring tokens; the signing secret and hashes never leave the server.
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                        Logging out (top-right menu) removes the token from this browser immediately.
                      </li>
                      <li className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                        This clinic&apos;s data is fully isolated from other businesses.
                      </li>
                    </ul>
                    <p className="border-t border-[#E2E8F0] pt-3 text-[11px] text-[#83909D]">
                      Remote token revocation (&ldquo;logout everywhere&rdquo;) is not available with the current
                      stateless token setup, so no such button is shown.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* Toasts */}
      {businessNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-sky-600/30 bg-[#FFFFFF] px-4 py-3 shadow-xl">
          <CheckCircle2 size={18} className="text-sky-600" />
          <p className="text-sm font-medium text-slate-900">{businessNotice}</p>
        </div>
      )}
      {prefsNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-sky-600/30 bg-[#FFFFFF] px-4 py-3 shadow-xl">
          <CheckCircle2 size={18} className="text-sky-600" />
          <p className="text-sm font-medium text-slate-900">{prefsNotice}</p>
        </div>
      )}
      {passwordNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-sky-600/30 bg-[#FFFFFF] px-4 py-3 shadow-xl">
          <CheckCircle2 size={18} className="text-sky-600" />
          <p className="text-sm font-medium text-slate-900">{passwordNotice}</p>
        </div>
      )}
    </div>
  );
}
