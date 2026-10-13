"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  Trash2,
  User,
} from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import PasswordInput from "@/components/PasswordInput";
import TopNavbar from "@/components/dashboard/TopNavbar";
import { useAuthMe } from "@/lib/useAuthMe";
import {
  validateProfile,
  validatePasswordChange,
  type ProfileFieldErrors,
  type PasswordChangeFieldErrors,
} from "@/lib/settingsValidation";

/**
 * Personal profile of the authenticated admin (users table via /api/profile).
 *
 * Sections: profile photo (upload/replace/remove), full name, email, phone,
 * and change password (PATCH /api/password — bcrypt verified server-side).
 * No clinic/business configuration lives here — that belongs to Settings.
 */

type ProfileData = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
};

const EMPTY_PASSWORDS = { currentPassword: "", newPassword: "", confirmPassword: "" };

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Photos are resized to this square (JPEG q0.85) before being saved. */
const PHOTO_SIZE = 512;

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
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the image.");

    const side = Math.min(image.width, image.height);
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    ctx.drawImage(image, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function ProfilePage() {
  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ---- Profile form state ----
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [errors, setErrors] = useState<ProfileFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // ---- Photo upload state ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resizing, setResizing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // ---- Change password state ----
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const [passwordErrors, setPasswordErrors] = useState<PasswordChangeFieldErrors>({});
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await authFetch("/api/profile");
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const result = (await response.json()) as {
        data: ProfileData | null;
        success: boolean;
      };
      if (!response.ok || !result.success || !result.data) {
        setLoadError(true);
        return;
      }
      setProfile(result.data);
      setFullName(result.data.name);
      setEmail(result.data.email);
      setPhone(result.data.phone ?? "");
      setPhotoUrl(result.data.photoUrl ?? "");
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!authLoading && me) loadProfile();
  }, [authLoading, me, loadProfile]);

  function showToast(setter: (v: string | null) => void, message: string) {
    setter(message);
    setTimeout(() => setter(null), 3500);
  }

  // ---- Profile photo ----
  async function handlePhotoFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError("Accepts JPG, PNG, WEBP only.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError("Image is too large (max 10MB).");
      return;
    }
    setResizing(true);
    try {
      const dataUrl = await resizeToDataUrl(file);
      setPhotoUrl(dataUrl);
    } catch {
      setPhotoError("Could not process this image. Please try another one.");
    } finally {
      setResizing(false);
    }
  }

  function removePhoto() {
    setPhotoError(null);
    setPhotoUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ---- Save profile ----
  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving || resizing) return; // prevent duplicate submissions

    const result = validateProfile({ fullName, email, phone, photoUrl });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const response = await authFetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: result.data.fullName,
          email: result.data.email,
          phone: result.data.phone ?? "",
          photoUrl: result.data.photoUrl ?? "",
        }),
      });
      const res = (await response.json()) as {
        data: (ProfileData & { errors?: Record<string, string> }) | null;
        success: boolean;
        message?: string;
      };
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok || !res.success) {
        if (response.status === 400 && res.data && "errors" in res.data && res.data.errors) {
          setErrors(res.data.errors as ProfileFieldErrors);
        }
        setFormError(res.message ?? "Unable to update your profile.");
        return;
      }
      setProfile(res.data);
      setFullName(res.data?.name ?? "");
      setEmail(res.data?.email ?? "");
      setPhone(res.data?.phone ?? "");
      setPhotoUrl(res.data?.photoUrl ?? "");
      showToast(setSavedNotice, "Profile updated successfully.");
    } catch {
      setFormError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---- Change password ----
  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    if (savingPassword) return; // prevent duplicate submissions

    const result = validatePasswordChange(passwords);
    if (!result.ok) {
      setPasswordErrors(result.errors);
      return;
    }
    setPasswordErrors({});
    setPasswordFormError(null);
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
          setPasswordErrors(res.data.errors as PasswordChangeFieldErrors);
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
          <p className="text-sm text-[#5B6B7C]">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load your profile.</p>
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

  const initials =
    fullName
      .split(/\s+/)
      .filter((w) => w.length > 0 && w.toLowerCase() !== "dr.")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  const inputClass = (hasError: boolean) =>
    `w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder-[#83909D] outline-none transition-colors ${
      hasError
        ? "border-red-500/60 focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
        : "border-[#E2E8F0] focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/15"
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
              <Link
                href="/dashboard"
                className="mb-2 inline-flex items-center gap-1.5 text-sm text-[#5B6B7C] transition-colors hover:text-sky-600"
              >
                <ArrowLeft size={14} /> Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Your personal information and account security.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 space-y-4">
              <div className="h-44 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]" />
              <div className="h-64 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]" />
            </div>
          ) : loadError || !profile ? (
            <div className="mt-6 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-10 text-center">
              <p className="text-sm text-[#5B6B7C]">Unable to load your profile.</p>
              <button
                type="button"
                onClick={loadProfile}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              {/* ===================== Personal information ===================== */}
              <form
                onSubmit={handleProfileSave}
                className="space-y-5 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6"
              >
                <h2 className="text-sm font-semibold text-slate-900">Personal Information</h2>

                {/* Profile photo */}
                <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border border-[#E2E8F0] bg-[#F1F5F9]">
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-sky-500/10 text-sky-600">
                        {fullName ? (
                          <span className="text-2xl font-bold">{initials}</span>
                        ) : (
                          <User size={34} />
                        )}
                      </div>
                    )}
                    {resizing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2 text-xs font-semibold text-[#0369A1] transition-colors hover:border-sky-500/40 hover:text-sky-600"
                    >
                      <Camera size={14} /> {photoUrl ? "Replace Photo" : "Upload Photo"}
                    </button>
                    {photoUrl && (
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20"
                      >
                        <Trash2 size={14} /> Remove Photo
                      </button>
                    )}
                    <p className="w-full text-[11px] text-[#83909D]">
                      Accepts JPG, PNG, WEBP. The photo is stored with your account in PostgreSQL.
                    </p>
                  </div>
                </div>
                {photoError && <p className="text-xs text-red-600">{photoError}</p>}
                {errors.photoUrl && <p className="text-xs text-red-600">{errors.photoUrl}</p>}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => void handlePhotoFile(e.target.files?.[0])}
                />

                {/* Fields */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">Full Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        setErrors((p) => ({ ...p, fullName: undefined }));
                      }}
                      placeholder="Your full name"
                      maxLength={100}
                      className={inputClass(!!errors.fullName)}
                    />
                    {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setErrors((p) => ({ ...p, email: undefined }));
                      }}
                      placeholder="you@clinic.com"
                      maxLength={255}
                      className={inputClass(!!errors.email)}
                    />
                    {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">Phone Number</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        setErrors((p) => ({ ...p, phone: undefined }));
                      }}
                      placeholder="+92 300 1234567"
                      maxLength={30}
                      className={inputClass(!!errors.phone)}
                    />
                    {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
                  </div>
                </div>

                {formError && (
                  <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-600">
                    {formError}
                  </p>
                )}

                <div className="flex items-center justify-end border-t border-[#E2E8F0] pt-5">
                  <button
                    type="submit"
                    disabled={saving || resizing}
                    className="rounded-xl bg-sky-500 px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              {/* ===================== Change password ===================== */}
              <form
                onSubmit={handlePasswordSave}
                className="space-y-5 self-start rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 md:p-6"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600">
                    <KeyRound size={16} />
                  </span>
                  <h2 className="text-sm font-semibold text-slate-900">Change Password</h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#5B6B7C]">Current Password</label>
                    <PasswordInput
                      value={passwords.currentPassword}
                      onChange={(e) => {
                        setPasswords((p) => ({ ...p, currentPassword: e.target.value }));
                        setPasswordErrors((p) => ({ ...p, currentPassword: undefined }));
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
                    <PasswordInput
                      value={passwords.newPassword}
                      onChange={(e) => {
                        setPasswords((p) => ({ ...p, newPassword: e.target.value }));
                        setPasswordErrors((p) => ({ ...p, newPassword: undefined }));
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
                    <PasswordInput
                      value={passwords.confirmPassword}
                      onChange={(e) => {
                        setPasswords((p) => ({ ...p, confirmPassword: e.target.value }));
                        setPasswordErrors((p) => ({ ...p, confirmPassword: undefined }));
                      }}
                      placeholder="Re-enter the new password"
                      autoComplete="new-password"
                      className={inputClass(!!passwordErrors.confirmPassword)}
                    />
                    {passwordErrors.confirmPassword && (
                      <p className="mt-1 text-xs text-red-600">{passwordErrors.confirmPassword}</p>
                    )}
                  </div>
                </div>

                {passwordFormError && (
                  <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-600">
                    {passwordFormError}
                  </p>
                )}

                <div className="flex items-center justify-end border-t border-[#E2E8F0] pt-5">
                  <button
                    type="submit"
                    disabled={savingPassword}
                    className="rounded-xl bg-sky-500 px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingPassword ? "Updating..." : "Update Password"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>

      {/* Saved toasts */}
      {savedNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-sky-600/30 bg-[#FFFFFF] px-4 py-3 shadow-xl">
          <CheckCircle2 size={18} className="text-sky-600" />
          <p className="text-sm font-medium text-slate-900">{savedNotice}</p>
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
