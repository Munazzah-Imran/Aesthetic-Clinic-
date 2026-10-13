"use client";

import { useMemo } from "react";
import { ASSIGNABLE_PERMISSIONS, isAssignablePermissionKey } from "@/lib/permissions";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/**
 * "Dashboard Page Permissions" checklist — options are generated from the
 * shared catalog's ASSIGNABLE subset (stable keys derived from the ACTUAL
 * existing dashboard routes; removed modules are never listed). Permission
 * options that are no longer assignable are excluded from display, counts,
 * Select All / Clear All and every value emitted by this picker.
 *
 * Select All / Clear All only touch THIS picker's value — i.e. the current
 * staff form's local selection — until the form is saved to PostgreSQL.
 */
export default function PermissionPicker({ value, onChange, disabled = false }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string }[]>();
    for (const p of ASSIGNABLE_PERMISSIONS) {
      const list = map.get(p.group) ?? [];
      list.push({ key: p.key, label: p.label });
      map.set(p.group, list);
    }
    return Array.from(map, ([group, items]) => ({ group, items }));
  }, []);

  // Ignore any non-assignable key that somehow reached `value` (stale state):
  // it is never rendered, counted, or emitted back through onChange.
  const selected = useMemo(
    () => new Set(value.filter(isAssignablePermissionKey)),
    [value]
  );
  const selectedCount = useMemo(() => value.filter(isAssignablePermissionKey).length, [value]);
  const allKeys = useMemo(() => ASSIGNABLE_PERMISSIONS.map((p) => p.key as string), []);

  function toggle(key: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(allKeys.filter((k) => next.has(k)));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[#5B6B7C]">
          {selectedCount} of {allKeys.length} pages selected
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => !disabled && onChange(allKeys.slice())}
            disabled={disabled}
            className="rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-1.5 text-xs font-medium text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600 disabled:opacity-60"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={() => !disabled && onChange([])}
            disabled={disabled}
            className="rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] px-2.5 py-1.5 text-xs font-medium text-[#5B6B7C] transition hover:border-sky-500/50 hover:text-sky-600 disabled:opacity-60"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#83909D]">
              {group}
            </p>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {items.map((item) => {
                const checked = selected.has(item.key);
                return (
                  <label
                    key={item.key}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                      checked
                        ? "border-sky-500/60 bg-sky-500/10"
                        : "border-[#E2E8F0] bg-[#F1F5F9]"
                    } ${disabled ? "opacity-60" : "cursor-pointer hover:border-sky-500/40"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(item.key)}
                      disabled={disabled}
                      className="h-4 w-4 rounded accent-sky-600"
                    />
                    <span
                      className={`min-w-0 truncate text-sm ${
                        checked ? "font-medium text-slate-900" : "text-[#1E293B]"
                      }`}
                    >
                      {item.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedCount === 0 && (
        <p className="mt-2 text-xs text-[#83909D]">
          No pages selected — this staff member will not be able to open any
          dashboard module until permissions are granted.
        </p>
      )}
    </div>
  );
}
