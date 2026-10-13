"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { authHeaders } from "@/lib/useAuthMe";
import PasswordInput from "@/components/PasswordInput";

/**
 * Forced first-login password change (staff accounts only).
 *
 * New staff accounts are created by the administrator with a temporary
 * password (stored ONLY as a bcrypt hash — never displayed or logged by the
 * system), and users.must_change_password (role='staff') starts TRUE. While
 * that flag is set, requireAuth() rejects every non-password API with 403,
 * and the dashboard layout renders this screen instead of the modules.
 *
 * Reuses the existing PATCH /api/password endpoint (current password is
 * verified server-side against the stored hash).
 */
export default function FirstLoginPassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    // Frontend guard (the server re-validates everything).
    const localErrors: Record<string, string> = {};
    if (!current) localErrors.currentPassword = "Current password is required";
    if (!next) localErrors.newPassword = "New password is required";
    else if (next.length < 8) localErrors.newPassword = "Password must be at least 8 characters";
    else if (next.length > 72) localErrors.newPassword = "Password must be 72 characters or fewer";
    if (!confirm) localErrors.confirmPassword = "Please confirm the new password";
    else if (next !== confirm) localErrors.confirmPassword = "Passwords do not match";
    setErrors(localErrors);
    setSubmitError(null);
    if (Object.keys(localErrors).length > 0) return;

    setSaving(true);
    try {
      const response = await fetch("/api/password", {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
          confirmPassword: confirm,
        }),
      });

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }

      const result = (await response.json()) as {
        data: { errors?: Record<string, string> } | null;
        error: string | null;
        success: boolean;
        message: string;
      };

      if (response.ok && result.success) {
        onDone(); // lifts the gate: permissions are re-fetched, modules render
        return;
      }

      if (
        response.status === 400 &&
        result.data &&
        typeof result.data === "object" &&
        result.data.errors
      ) {
        setErrors(result.data.errors);
        setSubmitError(result.message ?? "Please fix the highlighted fields.");
        return;
      }

      setSubmitError(result.message ?? result.error ?? "Unable to change the password.");
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = (hasError?: string) =>
    `w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-[#83909D] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 ${
      hasError ? "border-red-400/70" : "border-[#E2E8F0]"
    }`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6 sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
          <KeyRound size={22} />
        </div>
        <h1 className="mt-4 text-center text-xl font-bold text-slate-900">
          Set your password
        </h1>
        <p className="mt-2 text-center text-sm text-[#5B6B7C]">
          For your security, you must set a new password before you can use
          the dashboard. Use the temporary password you were given, then
          choose your own.
        </p>

        {submitError && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {submitError}
          </p>
        )}

        <form className="mt-5 space-y-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="current-password" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
              Temporary / current password <span className="ml-1 text-sky-600">*</span>
            </label>
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={fieldClass(errors.currentPassword)}
            />
            {errors.currentPassword && (
              <p className="text-xs text-red-600">{errors.currentPassword}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
              New password <span className="ml-1 text-sky-600">*</span>
            </label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={fieldClass(errors.newPassword)}
            />
            {errors.newPassword && (
              <p className="text-xs text-red-600">{errors.newPassword}</p>
            )}
            <p className="text-[11px] text-[#83909D]">Must be at least 8 characters</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-password" className="text-xs font-medium tracking-wide text-[#5B6B7C]">
              Confirm new password <span className="ml-1 text-sky-600">*</span>
            </label>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={fieldClass(errors.confirmPassword)}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-red-600">{errors.confirmPassword}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Set password & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
