"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  Loader2,
  Menu,
  Search,
  Settings,
  LogOut,
  UserRound,
  Settings2,
  Users,
} from "lucide-react";
import { authHeaders } from "@/lib/useAuthMe";

export type TopNavbarUser = {
  name: string;
};

type TopNavbarProps = {
  user: TopNavbarUser | null;
  onToggleSidebar: () => void;
};

const TOKEN_STORAGE_KEY = "token";

type AppointmentHit = {
  id: string;
  appointmentId: string;
  patientName: string;
  date: string;
  time: string;
};

type PatientHit = {
  id: string;
  patientCode: string;
  fullName: string;
  phone: string | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(value: string): string {
  const [y, m, d] = (value ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value ?? "";
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

function formatTime(value: string): string {
  const parts = (value ?? "").split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (parts.length < 2 || Number.isNaN(h) || Number.isNaN(m)) return "";
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export default function TopNavbar({ user, onToggleSidebar }: TopNavbarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ---- Global search (appointments + patients) ----
  const [query, setQuery] = useState("");
  const [appointments, setAppointments] = useState<AppointmentHit[]>([]);
  const [patients, setPatients] = useState<PatientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close the profile dropdown / search results when clicking outside.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(target)) {
        setResultsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Load the searchable records once (clinic-sized datasets; filtering is local).
  const loadSearchData = useCallback(async () => {
    setSearching(true);
    try {
      const [apptRes, patientRes] = await Promise.all([
        fetch("/api/appointments", { headers: authHeaders() }),
        fetch("/api/patients", { headers: authHeaders() }),
      ]);

      if (apptRes.ok) {
        const json = (await apptRes.json()) as {
          data: Record<string, unknown>[] | null;
        };
        setAppointments(
          (json.data ?? []).map((row) => {
            const patient =
              typeof row.patient === "object" && row.patient !== null
                ? (row.patient as Record<string, unknown>)
                : {};
            return {
              id: String(row.id ?? ""),
              appointmentId: String(row.appointmentId ?? ""),
              patientName: String(patient.fullName ?? ""),
              date: String(row.appointmentDate ?? ""),
              time: String(row.appointmentTime ?? ""),
            };
          })
        );
      }

      if (patientRes.ok) {
        const json = (await patientRes.json()) as {
          data: Record<string, unknown>[] | null;
        };
        setPatients(
          (json.data ?? []).map((row) => ({
            id: String(row.id ?? ""),
            patientCode: String(row.patient_id ?? row.patientId ?? ""),
            fullName: String(row.full_name ?? row.fullName ?? ""),
            phone:
              typeof row.phone === "string" && row.phone
                ? row.phone
                : null,
          }))
        );
      }
    } catch {
      // Network failure — search simply returns no matches.
    } finally {
      setSearching(false);
    }
  }, []);

  // Fetch lazily, the first time the user actually searches.
  function handleSearchFocus() {
    setResultsOpen(true);
    if (appointments.length === 0 && patients.length === 0 && !searching) {
      loadSearchData();
    }
  }

  const q = query.trim().toLowerCase();
  const matchedAppointments = q
    ? appointments
        .filter(
          (a) =>
            a.appointmentId.toLowerCase().includes(q) ||
            a.patientName.toLowerCase().includes(q)
        )
        .slice(0, 4)
    : [];
  const matchedPatients = q
    ? patients
        .filter(
          (p) =>
            p.fullName.toLowerCase().includes(q) ||
            p.patientCode.toLowerCase().includes(q) ||
            (p.phone ?? "").toLowerCase().includes(q)
        )
        .slice(0, 4)
    : [];
  const hasMatches = matchedAppointments.length > 0 || matchedPatients.length > 0;

  function goTo(path: string) {
    setQuery("");
    setResultsOpen(false);
    router.push(path);
  }

  function handleLogout() {
    // Clear the JWT (existing token storage) and go to login.
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Storage unavailable — still redirect.
    }
    setMenuOpen(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC]/95 px-4 backdrop-blur md:px-6">
      {/* Mobile sidebar toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="rounded-lg p-2 text-[#5B6B7C] hover:bg-sky-500/10 hover:text-sky-600 lg:hidden"
        aria-label="Toggle sidebar"
      >
        <Menu size={20} />
      </button>

      {/* Global search — appointments + patients */}
      <div className="relative hidden max-w-md flex-1 sm:block" ref={searchRef}>
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#83909D]"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setResultsOpen(true);
          }}
          onFocus={handleSearchFocus}
          onKeyDown={(e) => {
            if (e.key === "Escape") setResultsOpen(false);
          }}
          placeholder="Search appointments, patients..."
          className="h-10 w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] pl-9 pr-10 text-sm text-slate-900 placeholder-[#83909D] outline-none transition-colors focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/15"
        />
        {searching && (
          <Loader2
            size={15}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#83909D]"
          />
        )}

        {resultsOpen && q !== "" && (
          <div className="animate-dropdown-in absolute left-0 right-0 top-12 overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] py-1.5 shadow-2xl shadow-black/10">
            {!hasMatches && !searching && (
              <p className="px-4 py-3 text-sm text-[#83909D]">
                No appointments or patients match &ldquo;{query.trim()}&rdquo;.
              </p>
            )}

            {matchedAppointments.length > 0 && (
              <div>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#83909D]">
                  Appointments
                </p>
                {matchedAppointments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => goTo("/dashboard/appointments")}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-sky-500/10"
                  >
                    <CalendarDays size={15} className="shrink-0 text-sky-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {a.patientName || a.appointmentId}
                      </span>
                      <span className="block truncate text-xs text-[#83909D]">
                        {a.appointmentId} · {formatDate(a.date)} {formatTime(a.time)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {matchedPatients.length > 0 && (
              <div className="border-t border-[#E2E8F0]">
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#83909D]">
                  Patients
                </p>
                {matchedPatients.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => goTo("/dashboard/patients")}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-sky-500/10"
                  >
                    <Users size={15} className="shrink-0 text-sky-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {p.fullName}
                      </span>
                      <span className="block truncate text-xs text-[#83909D]">
                        {p.patientCode}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Flexible spacer: always pushes the right cluster to the far right end */}
      <div className="ml-auto flex-1" />

      {/* Right cluster (far right end of the navbar) */}
      <div className="flex items-center gap-1.5 md:gap-2">
        {/* Notifications — links to the Reminders page */}
        <Link
          href="/dashboard/reminders"
          className="relative rounded-lg p-2 text-[#5B6B7C] hover:bg-sky-500/10 hover:text-sky-600"
          aria-label="Notifications"
          title="Reminders"
        >
          <Bell size={18} />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sky-500 ring-2 ring-[#F8FAFC]" />
        </Link>

        {/* Settings — links to the Settings page */}
        <Link
          href="/dashboard/settings"
          className="rounded-lg p-2 text-[#5B6B7C] hover:bg-sky-500/10 hover:text-sky-600"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </Link>

        {/* Profile + dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] py-1.5 pl-1.5 pr-3 transition-colors hover:border-sky-500/40"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-xs font-semibold text-sky-600">
              {user?.name ? user.name.slice(0, 1).toUpperCase() : "?"}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm font-medium text-slate-900 md:block">
              {user?.name ?? ""}
            </span>
          </button>

          {menuOpen && (
            <div className="animate-dropdown-in absolute right-0 top-12 w-52 overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] py-1.5 shadow-2xl shadow-black/10">
              <div className="border-b border-[#E2E8F0] px-4 pb-2.5 pt-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {user?.name ?? ""}
                </p>
              </div>
              <Link
                href="/dashboard/profile"
                className="mt-1.5 flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-[#5B6B7C] transition-colors hover:bg-sky-500/10 hover:text-sky-600"
                onClick={() => setMenuOpen(false)}
              >
                <UserRound size={16} /> Profile
              </Link>
              <Link
                href="/dashboard/settings"
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-[#5B6B7C] transition-colors hover:bg-sky-500/10 hover:text-sky-600"
                onClick={() => setMenuOpen(false)}
              >
                <Settings2 size={16} /> Settings
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-1.5 flex w-full items-center gap-2.5 border-t border-[#E2E8F0] px-4 py-2.5 text-sm text-[#5B6B7C] transition-colors hover:bg-red-500/10 hover:text-red-600"
              >
                <LogOut size={16} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
