"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Inbox, Info, Mail, Plus, Search, Send, Star, X } from "lucide-react";
import Sidebar from "@/components/dashboard/Sidebar";
import TopNavbar from "@/components/dashboard/TopNavbar";
import StatCard from "@/components/dashboard/StatCard";
import { useAuthMe } from "@/lib/useAuthMe";
import { formatShortDate, formatTime, initialsOf } from "@/lib/dashboardFormat";
import { TEMP_SAMPLE_MESSAGES, type TempStaffMessage } from "./tempSampleMessages";

/**
 * Staff Inbox — FRONTEND UI STEP ONLY.
 *
 * The layout, filters, search, detail panel and compose form are real
 * client-side UI built on the existing dashboard shell; the messages
 * themselves are TEMPORARY sample data (see ./tempSampleMessages.ts) and
 * are clearly labelled as a preview on the page. No database queries, API
 * routes or auth changes are made here — the backend connection arrives in
 * the next step and will replace the sample file.
 */

const ALL_TABS = [
  { id: "all", label: "All Messages" },
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "unread", label: "Unread" },
  { id: "important", label: "Important" },
  { id: "archived", label: "Archived" },
] as const;

type TabId = (typeof ALL_TABS)[number]["id"];

const PRIORITY_LABELS: Record<TempStaffMessage["priority"], string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
};

/** Same badge language as the rest of the dashboard (red/amber/blue chips). */
const PRIORITY_STYLES: Record<TempStaffMessage["priority"], string> = {
  urgent: "bg-red-500/15 text-red-700 border-red-500/30",
  high: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  normal: "bg-[#0369A1]/15 text-[#0369A1] border-[#0369A1]/30",
};

/** In-palette avatar tints (sky / emerald / teal / amber / slate only). */
const AVATAR_STYLES = [
  "bg-sky-500/15 text-sky-600",
  "bg-emerald-500/15 text-emerald-600",
  "bg-teal-500/15 text-teal-600",
  "bg-amber-500/15 text-amber-600",
  "bg-slate-500/15 text-slate-600",
];

function avatarStyleFor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_STYLES[sum % AVATAR_STYLES.length];
}

/** Short single-line preview derived from the body (never stored twice). */
function previewOf(m: TempStaffMessage): string {
  return m.body.length > 120 ? `${m.body.slice(0, 120).trimEnd()}…` : m.body;
}

/**
 * "09:15" extracted from the sample ISO timestamp so the SHARED
 * `formatTime` helper (which expects an HH:MM value) can render it —
 * no second time formatter is introduced.
 */
function timeOf(iso: string): string {
  return formatTime(iso.length >= 16 ? iso.slice(11, 16) : "");
}

export default function StaffInboxPage() {
  const { me, loading, loadError, retry } = useAuthMe();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Local, temporary UI state (sample rows only — reset on reload).
  const [messages, setMessages] = useState<TempStaffMessage[]>(TEMP_SAMPLE_MESSAGES);
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Compose form (UI only — nothing is persisted or sent yet).
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeErrors, setComposeErrors] = useState<{
    to?: string;
    subject?: string;
    body?: string;
  }>({});
  const [composeError, setComposeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  // ---------------- Derived (pure client-side) ----------------
  const active = useMemo(() => messages.filter((m) => m.folder !== "archived"), [messages]);

  const counts = useMemo(
    () => ({
      all: active.length,
      inbox: active.filter((m) => m.folder === "inbox").length,
      sent: active.filter((m) => m.folder === "sent").length,
      unread: active.filter((m) => !m.read).length,
      important: active.filter((m) => m.important).length,
      archived: messages.filter((m) => m.folder === "archived").length,
    }),
    [active, messages]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      switch (tab) {
        case "inbox":
          if (m.folder !== "inbox") return false;
          break;
        case "sent":
          if (m.folder !== "sent") return false;
          break;
        case "unread":
          if (m.read || m.folder === "archived") return false;
          break;
        case "important":
          if (!m.important || m.folder === "archived") return false;
          break;
        case "archived":
          if (m.folder !== "archived") return false;
          break;
        default:
          if (m.folder === "archived") return false;
      }
      if (q === "") return true;
      return (
        m.senderName.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q)
      );
    });
  }, [messages, tab, search]);

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId]
  );

  // ---------------- Local preview interactions ----------------
  function openMessage(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
    // Read-state is local preview behaviour only (no backend involved).
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
  }

  function toggleStar(id: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, important: !m.important } : m))
    );
  }

  function openCompose() {
    setComposeOpen(true);
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeErrors({});
    setComposeError(null);
  }

  async function submitCompose() {
    if (sending) return; // no duplicate submissions
    const errors: typeof composeErrors = {};
    if (composeTo.trim() === "") errors.to = "Recipient is required.";
    if (composeSubject.trim() === "") errors.subject = "Subject is required.";
    if (composeBody.trim() === "") errors.body = "Message is required.";
    if (Object.keys(errors).length > 0) {
      setComposeErrors(errors);
      return;
    }
    setSending(true);
    try {
      // Frontend-only step: honestly report that nothing was sent.
      await new Promise((r) => setTimeout(r, 400));
      setComposeOpen(false);
      showToast("Not sent yet — message delivery connects in the backend step.");
    } finally {
      setSending(false);
    }
  }

  // ---------------- Auth loading / error (same shell as other modules) ----------------
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-sky-500" />
      </div>
    );
  }

  if (loadError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center">
          <p className="text-sm text-[#5B6B7C]">Unable to load staff inbox.</p>
          <button
            type="button"
            onClick={retry}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const businessName = me.business?.business_name ?? "My Clinic";

  // ---------------- Detail content (shared by desktop panel + mobile overlay) ----------------
  const detail = (m: TempStaffMessage | null, withBack: boolean) => {
    if (!m) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
            <Mail size={26} />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-900">No message selected</p>
          <p className="mt-1 text-sm text-[#5B6B7C]">
            Choose a conversation from the list to preview it here.
          </p>
        </div>
      );
    }
    return (
      <>
        <div className="flex items-start justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {withBack && (
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                title="Back to list"
                aria-label="Back to message list"
                className="shrink-0 rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarStyleFor(
                m.folder === "sent" ? me.user.name : m.senderName
              )}`}
            >
              {initialsOf(m.folder === "sent" ? me.user.name : m.senderName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {m.senderName}
                <span className="ml-2 text-xs font-normal text-[#83909D]">
                  {m.senderRole}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-[#5B6B7C]">
                {formatShortDate(m.at)} · {timeOf(m.at)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleStar(m.id)}
            title={m.important ? "Remove importance" : "Mark as important"}
            aria-label={m.important ? "Remove importance" : "Mark as important"}
            className="shrink-0 rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-amber-500/50"
          >
            <Star
              size={16}
              className={m.important ? "fill-amber-400 text-amber-500" : "text-[#83909D]"}
            />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-base font-semibold text-slate-900">{m.subject}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${PRIORITY_STYLES[m.priority]}`}
            >
              {PRIORITY_LABELS[m.priority]}
            </span>
            <span className="inline-flex whitespace-nowrap rounded-full border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-0.5 text-[11px] font-medium text-[#5B6B7C]">
              {m.category}
            </span>
            <span className="inline-flex whitespace-nowrap rounded-full border border-sky-600/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium capitalize text-sky-600">
              {m.folder}
            </span>
            {!m.read && (
              <span className="inline-flex whitespace-nowrap rounded-full border border-sky-600/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-600">
                Unread
              </span>
            )}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#1E293B]">{m.body}</p>
        </div>

        <div className="border-t border-[#E2E8F0] px-5 py-3">
          <p className="text-[11px] text-[#83909D]">
            Preview only — replies and delivery arrive with the backend integration.
          </p>
        </div>
      </>
    );
  };

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
              <h1 className="text-2xl font-bold text-slate-900">Staff Inbox</h1>
              <p className="mt-1.5 text-sm text-[#5B6B7C]">
                Manage internal clinic communications
              </p>
            </div>
            <button
              type="button"
              onClick={openCompose}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-600"
            >
              <Plus size={16} /> New Message
            </button>
          </div>

          {/* Honest preview notice — this step is frontend-only. */}
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <Info size={15} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs leading-5 text-amber-700">
              UI preview — the messages below are temporary sample data used for layout
              only. No database or backend is connected yet; real staff messages arrive
              with the next (backend) step.
            </p>
          </div>

          {/* Summary cards — counts derived from the preview dataset. */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Inbox} title="Total Messages" value={String(counts.all)} />
            <StatCard icon={Mail} title="Unread" value={String(counts.unread)} />
            <StatCard icon={Send} title="Sent" value={String(counts.sent)} />
            <StatCard icon={Star} title="Important" value={String(counts.important)} />
          </div>

          {/* Search + filter tabs */}
          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-[340px]">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#83909D]"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by sender or subject..."
                aria-label="Search messages by sender or subject"
                className="w-full rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] py-2.5 pl-10 pr-4 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
              />
            </div>

            {/* Horizontally scrollable tabs on small screens */}
            <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
              <div className="inline-flex w-max items-center gap-1 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-1">
                {ALL_TABS.map((t) => {
                  const activeTab = tab === t.id;
                  const n = counts[t.id];
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      aria-pressed={activeTab}
                      className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                        activeTab
                          ? "bg-sky-500 text-slate-900"
                          : "text-[#5B6B7C] hover:bg-[#F1F5F9] hover:text-slate-900"
                      }`}
                    >
                      {t.label}
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          activeTab
                            ? "bg-slate-900/15"
                            : "bg-[#F1F5F9] text-[#83909D]"
                        }`}
                      >
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* List + detail */}
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            {/* Message list */}
            <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
              {filtered.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600">
                    <Inbox size={26} />
                  </div>
                  <p className="mt-4 text-sm font-medium text-slate-900">No messages found</p>
                  <p className="mt-1 text-sm text-[#5B6B7C]">
                    {search.trim() !== ""
                      ? "Try a different sender or subject."
                      : "This filter has no messages right now."}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0]">
                  {filtered.map((m) => {
                    const isSelected = selectedId === m.id;
                    const displayName = m.folder === "sent" ? "You" : m.senderName;
                    const avatarName = m.folder === "sent" ? me.user.name : m.senderName;
                    return (
                      <div
                        key={m.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openMessage(m.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openMessage(m.id);
                          }
                        }}
                        className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 outline-none transition-colors focus-visible:bg-sky-500/10 ${
                          isSelected
                            ? "bg-sky-500/10"
                            : m.read
                              ? "bg-[#FFFFFF] hover:bg-[#E8EEF4]"
                              : "bg-sky-500/[0.04] hover:bg-[#E8EEF4]"
                        }`}
                      >
                        {/* Read / unread indicator */}
                        <span className="mt-2 shrink-0">
                          {m.read ? (
                            <span className="block h-2 w-2 rounded-full bg-transparent" />
                          ) : (
                            <span
                              className="block h-2 w-2 rounded-full bg-sky-500"
                              title="Unread"
                            />
                          )}
                        </span>

                        {/* Avatar / initials */}
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarStyleFor(
                            avatarName
                          )}`}
                        >
                          {initialsOf(avatarName)}
                        </span>

                        {/* Text block */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`min-w-0 truncate text-sm text-[#1E293B] ${
                                m.read ? "font-medium" : "font-bold"
                              }`}
                            >
                              {displayName}
                            </span>
                            <span
                              className={`hidden shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${PRIORITY_STYLES[m.priority]}`}
                            >
                              {PRIORITY_LABELS[m.priority]}
                            </span>
                          </div>
                          <p
                            className={`mt-0.5 truncate text-sm text-[#1E293B] ${
                              m.read ? "font-medium" : "font-semibold"
                            }`}
                          >
                            {m.subject}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#83909D]">
                            {previewOf(m)}
                          </p>
                        </div>

                        {/* Time + star */}
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="whitespace-nowrap text-[11px] text-[#83909D]">
                            {formatShortDate(m.at)} · {timeOf(m.at)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStar(m.id);
                            }}
                            title={m.important ? "Remove importance" : "Mark as important"}
                            aria-label={m.important ? "Remove importance" : "Mark as important"}
                            className="rounded-lg p-1 transition hover:bg-amber-500/10"
                          >
                            <Star
                              size={15}
                              className={
                                m.important
                                  ? "fill-amber-400 text-amber-500"
                                  : "text-[#83909D] hover:text-amber-500"
                              }
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Desktop detail panel */}
            <div className="sticky top-6 hidden max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm lg:flex">
              {detail(selected, false)}
            </div>
          </div>
        </main>
      </div>

      {/* Mobile / tablet detail overlay */}
      {mobileDetailOpen && selected && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#FFFFFF] lg:hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            {detail(selected, true)}
          </div>
        </div>
      )}

      {/* Compose modal (UI only) */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">New Message</h3>
                <p className="mt-1 text-sm text-[#5B6B7C]">
                  Compose an internal message to your clinic staff.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                disabled={sending}
                title="Close"
                aria-label="Close compose form"
                className="shrink-0 rounded-lg border border-[#E2E8F0] p-2 text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600 disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>

            {composeError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {composeError}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  To <span className="ml-1 text-sky-600">*</span>
                </label>
                <input
                  type="text"
                  value={composeTo}
                  onChange={(e) => {
                    setComposeTo(e.target.value);
                    setComposeErrors((p) => ({ ...p, to: undefined }));
                  }}
                  placeholder="Staff name or role"
                  className={`rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20 ${
                    composeErrors.to ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {composeErrors.to && (
                  <p className="text-xs text-red-600">{composeErrors.to}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Subject <span className="ml-1 text-sky-600">*</span>
                </label>
                <input
                  type="text"
                  value={composeSubject}
                  onChange={(e) => {
                    setComposeSubject(e.target.value);
                    setComposeErrors((p) => ({ ...p, subject: undefined }));
                  }}
                  placeholder="What is this about?"
                  className={`rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20 ${
                    composeErrors.subject ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {composeErrors.subject && (
                  <p className="text-xs text-red-600">{composeErrors.subject}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium tracking-wide text-[#5B6B7C]">
                  Message <span className="ml-1 text-sky-600">*</span>
                </label>
                <textarea
                  value={composeBody}
                  onChange={(e) => {
                    setComposeBody(e.target.value);
                    setComposeErrors((p) => ({ ...p, body: undefined }));
                  }}
                  rows={5}
                  placeholder="Write your message..."
                  className={`resize-none rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-sm text-[#1E293B] placeholder:text-[#83909D] outline-none transition focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20 ${
                    composeErrors.body ? "border-red-400/70" : "border-[#E2E8F0]"
                  }`}
                />
                {composeErrors.body && (
                  <p className="text-xs text-red-600">{composeErrors.body}</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                disabled={sending}
                className="rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-2.5 text-sm font-semibold text-[#5B6B7C] transition-colors hover:text-slate-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitCompose()}
                disabled={sending}
                className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-600 disabled:opacity-60"
              >
                <Send size={15} />
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-sky-600/30 bg-[#FFFFFF] px-4 py-3 shadow-xl">
          <Info size={18} className="text-sky-600" />
          <p className="text-sm font-medium text-slate-900">{toast}</p>
        </div>
      )}
    </div>
  );
}
