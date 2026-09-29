"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Calendar,
  Users,
  Stethoscope,
  Building2,
  CalendarClock,
  CalendarOff,
  Clock3,
  Ban,
  HeartPulse,
  FileImage,
  Video,
  Siren,
  Inbox,
  HandHelping,
  UsersRound,
  Bell,
  ClipboardList,
  X,
} from "lucide-react";

export type SidebarUser = {
  name: string;
  businessName: string;
};

type SidebarProps = {
  user: SidebarUser | null;
  open: boolean;
  onClose: () => void;
};

type NavEntry = {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  exact?: boolean; // match only the exact pathname (used for /dashboard)
};

type NavSection = {
  heading: string;
  items: NavEntry[];
};

/**
 * Sidebar structure (order fixed per design spec):
 *   MAIN → DOCTOR & CLINICS → PATIENT SERVICES → COMMUNICATION → MANAGEMENT
 */
const SECTIONS: NavSection[] = [
  {
    heading: "MAIN",
    items: [
      { label: "Overview", icon: LayoutDashboard, href: "/dashboard", exact: true },
      { label: "Appointments", icon: CalendarDays, href: "/dashboard/appointments" },
      { label: "Calendar", icon: Calendar, href: "/dashboard/calendar" },
      { label: "Patients", icon: Users, href: "/dashboard/patients" },
    ],
  },
  {
    heading: "DOCTOR & CLINICS",
    items: [
      { label: "Doctor Profile", icon: Stethoscope, href: "/dashboard/doctors" },
      { label: "Clinics", icon: Building2, href: "/dashboard/clinics" },
      { label: "Weekly Schedule", icon: CalendarClock, href: "/dashboard/weekly-schedule" },
      { label: "Off-Days", icon: CalendarOff, href: "/dashboard/off-days" },
      { label: "Special Schedules", icon: Clock3, href: "/dashboard/special-schedules" },
      { label: "Blocked Slots", icon: Ban, href: "/dashboard/blocked-slots" },
    ],
  },
  {
    heading: "PATIENT SERVICES",
    items: [
      { label: "Services / Treatments", icon: HeartPulse, href: "/dashboard/services" },
      { label: "Uploaded Reports / Images", icon: FileImage, href: "/dashboard/reports" },
      { label: "Virtual Consultation", icon: Video, href: "/dashboard/virtual-consultation" },
      { label: "Emergency Alerts", icon: Siren, href: "/dashboard/emergency-alerts" },
    ],
  },
  {
    heading: "COMMUNICATION",
    items: [
      { label: "Staff Inbox", icon: Inbox, href: "/dashboard/staff-inbox" },
      { label: "Human Handover", icon: HandHelping, href: "/dashboard/human-handover" },
    ],
  },
  {
    heading: "MANAGEMENT",
    items: [
      { label: "Staff", icon: UsersRound, href: "/dashboard/staff" },
      { label: "Reminders", icon: Bell, href: "/dashboard/reminders" },
      { label: "Audit Logs", icon: ClipboardList, href: "/dashboard/audit-logs" },
      { label: "System Health", icon: HeartPulse, href: "/dashboard/system-health" },
    ],
  },
];

export default function Sidebar({ user, open, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col border-r border-blue-900/60 bg-gradient-to-b from-blue-700 via-blue-800 to-blue-900 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 text-blue-200 hover:text-white lg:hidden"
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>

        {/* Branding — dynamic business name from the authenticated user */}
        <div className="flex items-center gap-3 px-4 pb-4 pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-xs font-bold text-white shadow-md shadow-blue-900/30 backdrop-blur">
            {user?.businessName ? user.businessName.slice(0, 2).toUpperCase() : "AC"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {user?.businessName ?? ""}
            </p>
            <p className="text-[11px] text-blue-200">Admin Dashboard</p>
          </div>
        </div>

        {/* Scrollable navigation (hidden scrollbar, keyboard focusable) */}
        <nav
          aria-label="Dashboard navigation"
          className="sidebar-scroll flex-1 overflow-y-auto px-3 pb-6"
        >
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <p className="px-3 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-300">
                {section.heading}
              </p>
              {section.items.map((item) => (
                <NavItem
                  key={item.label}
                  {...item}
                  active={
                    item.exact
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(item.href + "/")
                  }
                  onNavigate={onClose}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom user chip — dynamic user name */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/10 p-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-semibold text-white">
              {user?.name ? user.name.slice(0, 1).toUpperCase() : "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-white">{user?.name ?? ""}</p>
              <p className="text-[10px] text-blue-200">Administrator</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  label,
  icon: Icon,
  href,
  active,
  onNavigate,
}: NavEntry & { active: boolean; onNavigate: () => void }) {
  const className = `mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 ${
    active
      ? "bg-white font-medium text-blue-800 shadow-md shadow-blue-900/30"
      : "text-blue-100 hover:bg-white/10 hover:text-white"
  }`;

  return (
    <Link
      href={href}
      className={className}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      <Icon size={16} className={`shrink-0 ${active ? "text-blue-700" : "text-blue-300"}`} />
      <span className="truncate">{label}</span>
    </Link>
  );
}
