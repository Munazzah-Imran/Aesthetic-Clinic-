"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RotateCcw } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import DoctorProfileForm, {
  EMPTY_DOCTOR_PROFILE,
  type DoctorBranchOption,
  type DoctorProfileValues,
} from "@/components/dashboard/DoctorProfileForm";
import {
  EMPTY_SCHEDULE,
  type ScheduleValues,
} from "@/components/dashboard/ConsultationScheduleFields";
import type {
  DoctorProfileFieldErrors,
  ConsultationDay,
} from "@/lib/doctorValidation";
import { useAuthMe } from "@/lib/useAuthMe";

type ProfileResponse = {
  data: Record<string, unknown> | null;
  success: boolean;
  message?: string;
};

type DoctorResponse = {
  data: {
    fullName: string;
    specialty: string | null;
    professionalTitle: string | null;
    status: string;
    consultationDays: string | null;
    consultationStartTime: string | null;
    consultationEndTime: string | null;
  } | null;
  success: boolean;
  message?: string;
};

function mapProfile(row: Record<string, unknown>): DoctorProfileValues {
  const str = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : "");
  return {
    photoUrl: str("photo_url"),
    fullName: str("full_name"),
    professionalTitle: str("professional_title"),
    specialty: str("specialty"),
    experience: str("experience"),
    qualifications: str("qualifications"),
    additionalQualifications: str("additional_qualifications"),
    shortBio: str("short_bio"),
    fullBio: str("full_bio"),
    professionalInterests: str("professional_interests"),
    areasOfExpertise: str("areas_of_expertise"),
    phone: str("phone"),
    email: str("email"),
    languages: str("languages"),
    clinicId: str("clinic_id"),
  };
}

/** Branch options come back alongside the profile (same business only). */
function mapBranches(row: Record<string, unknown>): DoctorBranchOption[] {
  if (!Array.isArray(row.branches)) return [];
  return row.branches
    .filter(
      (b): b is Record<string, unknown> =>
        !!b && typeof b === "object" && typeof (b as Record<string, unknown>).id === "string"
    )
    .map((b) => ({
      id: b.id as string,
      clinic_name: typeof b.clinic_name === "string" ? b.clinic_name : "",
      city: typeof b.city === "string" ? b.city : "",
    }));
}

/**
 * Manage Doctor Profile for ONE doctor (route: /dashboard/doctors/[id]).
 *
 * The doctor id comes from the route, so switching between doctors remounts
 * and re-fetches — Doctor A's data can never leak into Doctor B's form.
 */
export default function DoctorProfilePage() {
  const params = useParams<{ id: string }>();
  const doctorId = params?.id ?? null;

  const { me, loading: authLoading, loadError: authError, retry: retryAuth, authFetch } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [values, setValues] = useState<DoctorProfileValues>(EMPTY_DOCTOR_PROFILE);
  const [errors, setErrors] = useState<DoctorProfileFieldErrors>({});
  const [schedule, setSchedule] = useState<ScheduleValues>(EMPTY_SCHEDULE);
  const [scheduleErrors, setScheduleErrors] = useState<Partial<Record<keyof ScheduleValues, string | undefined>>>({});
  const [doctorInfo, setDoctorInfo] = useState<{
    fullName: string;
    specialty: string | null;
    professionalTitle: string | null;
    status: string;
  } | null>(null);
  const [branches, setBranches] = useState<DoctorBranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Monotonic load counter: a slow response for Doctor A can never overwrite
  // the form after the route has already switched to Doctor B (no stale data).
  const loadSeq = useRef(0);

  const loadProfile = useCallback(async () => {
    if (!doctorId) return;
    const seq = ++loadSeq.current;
    const stale = () => loadSeq.current !== seq;
    setLoading(true);
    setLoadError(false);
    setNotFound(false);
    try {
      // Profile (doctor_profiles) + doctor row (owns the consultation schedule)
      // load together so the schedule section shows the saved values.
      const [profileRes, doctorRes] = await Promise.all([
        authFetch(`/api/doctors/${doctorId}/profile`),
        authFetch(`/api/doctors/${doctorId}`),
      ]);
      if (stale()) return;
      if (profileRes.status === 401 || doctorRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (profileRes.status === 404 || doctorRes.status === 404) {
        setNotFound(true);
        return;
      }
      const profileResult = (await profileRes.json()) as ProfileResponse;
      const doctorResult = (await doctorRes.json()) as DoctorResponse;
      if (stale()) return;
      if (
        !profileRes.ok ||
        !profileResult.success ||
        !doctorRes.ok ||
        !doctorResult.success ||
        !doctorResult.data
      ) {
        setLoadError(true);
        return;
      }
      // New doctor (no profile yet) -> fresh empty form; existing -> this
      // doctor's row only.
      setValues(profileResult.data ? mapProfile(profileResult.data) : EMPTY_DOCTOR_PROFILE);
      setBranches(profileResult.data ? mapBranches(profileResult.data) : []);

      // Consultation schedule lives on the doctor row, not the profile.
      const d = doctorResult.data;
      setDoctorInfo({
        fullName: d.fullName,
        specialty: d.specialty,
        professionalTitle: d.professionalTitle,
        status: d.status,
      });
      setSchedule({
        consultationDays: d.consultationDays
          ? (String(d.consultationDays)
              .split(",")
              .filter((day): day is ConsultationDay =>
                ([
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ] as readonly string[]).includes(day)
              ))
          : [],
        consultationStartTime: d.consultationStartTime ?? "",
        consultationEndTime: d.consultationEndTime ?? "",
      });
    } catch {
      if (!stale()) setLoadError(true);
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [authFetch, doctorId]);

  useEffect(() => {
    if (!authLoading && me) loadProfile();
  }, [authLoading, me, loadProfile]);

  const handleSave = useCallback(
    async (formValues: DoctorProfileValues): Promise<string | null> => {
      if (!doctorId) return "Doctor not found.";
      try {
        const response = await authFetch(`/api/doctors/${doctorId}/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formValues),
        });
        const result = (await response.json()) as ProfileResponse & {
          data?: { errors?: Record<string, string> } | null;
        };
        if (!response.ok || !result.success) {
          if (response.status === 400 && result.data && "errors" in result.data && result.data.errors) {
            setErrors(result.data.errors as DoctorProfileFieldErrors);
            return "Please fix the highlighted fields.";
          }
          return result.message ?? "Unable to save the doctor profile.";
        }

        // The consultation schedule lives on the doctor row — persist it via
        // PATCH /api/doctors/[id] so the schedule section is never silently
        // lost. Doctor identity fields are sent back unchanged.
        if (doctorInfo) {
          const scheduleResponse = await authFetch(`/api/doctors/${doctorId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fullName: doctorInfo.fullName,
              specialty: doctorInfo.specialty,
              professionalTitle: doctorInfo.professionalTitle,
              status: doctorInfo.status,
              consultationDays: schedule.consultationDays,
              consultationStartTime: schedule.consultationStartTime,
              consultationEndTime: schedule.consultationEndTime,
            }),
          });
          const scheduleResult = (await scheduleResponse.json()) as ProfileResponse & {
            data?: { errors?: Record<string, string> } | null;
          };
          if (!scheduleResponse.ok || !scheduleResult.success) {
            if (
              scheduleResponse.status === 400 &&
              scheduleResult.data &&
              "errors" in scheduleResult.data &&
              scheduleResult.data.errors
            ) {
              setScheduleErrors(scheduleResult.data.errors);
            }
            return (
              scheduleResult.message ??
              "Profile saved but the consultation schedule could not be updated."
            );
          }
        }

        setSavedNotice("Doctor profile saved successfully.");
        setTimeout(() => setSavedNotice(null), 3500);
        return null;
      } catch {
        return "Could not reach the server.";
      }
    },
    [authFetch, doctorId, doctorInfo, schedule]
  );

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
          <p className="text-sm text-[#5B6B7C]">Loading doctor profile...</p>
        </div>
      </div>
    );
  }

  if (authError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load the doctor profile.</p>
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
              <Link
                href="/dashboard/doctors"
                className="mb-2 inline-flex items-center gap-1.5 text-sm text-[#5B6B7C] transition-colors hover:text-sky-600"
              >
                <ArrowLeft size={14} /> Back to Doctors
              </Link>
              <h1 className="text-2xl font-bold text-slate-900">Manage Doctor Profile</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Detailed profile for this doctor — photo, qualifications, biographies and contact details.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 space-y-4">
              <div className="h-40 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]" />
              <div className="h-64 animate-pulse rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF]" />
            </div>
          ) : notFound ? (
            <div className="mt-6 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-10 text-center">
              <p className="text-sm text-[#5B6B7C]">Doctor not found in your clinic.</p>
              <Link
                href="/dashboard/doctors"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <ArrowLeft size={16} /> Back to Doctors
              </Link>
            </div>
          ) : loadError ? (
            <div className="mt-6 rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-10 text-center">
              <p className="text-sm text-[#5B6B7C]">Unable to load the doctor profile.</p>
              <button
                type="button"
                onClick={loadProfile}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
              >
                <RotateCcw size={16} /> Retry
              </button>
            </div>
          ) : (
            <div className="mt-6 rounded-3xl border border-[#E2E8F0] bg-[#F8FAFC] p-5 sm:p-8">
              <DoctorProfileForm
                key={doctorId ?? "new"}
                values={values}
                errors={errors}
                onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
                onErrors={(next) => setErrors(next)}
                onSave={handleSave}
                onPhotoRemoved={() => setValues((prev) => ({ ...prev, photoUrl: "" }))}
                schedule={schedule}
                scheduleErrors={scheduleErrors}
                onScheduleChange={(key, value) =>
                  setSchedule((prev) => ({ ...prev, [key]: value }))
                }
                onScheduleErrors={(next) => setScheduleErrors(next)}
                branches={branches}
              />
            </div>
          )}
        </main>
      </div>

      {/* Saved toast */}
      {savedNotice && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-sky-600/30 bg-[#FFFFFF] px-4 py-3 shadow-xl">
          <p className="text-sm font-medium text-slate-900">{savedNotice}</p>
        </div>
      )}
    </div>
  );
}
