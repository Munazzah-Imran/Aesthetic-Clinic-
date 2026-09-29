"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type FormSelectOption = {
  value: string;
  label: string;
  /** Optional smaller text shown under the label (e.g. specialty, city). */
  hint?: string;
};

/**
 * Themed dropdown that replaces the native <select> everywhere.
 * Fully controlled, closes on outside click / Escape / option pick, and
 * animates open in line with the app's sky-on-dark theme.
 */
export default function FormSelect({
  value,
  options,
  onChange,
  placeholder = "Select an option",
  disabled = false,
  hasError = false,
  id,
  className = "",
}: {
  value: string;
  options: FormSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  id?: string;
  /** Extra classes for the trigger button (width etc.). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  // Close when clicking outside the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger — styled like the app's inputs */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded-xl border bg-[#F1F5F9] px-3.5 py-2.5 text-left text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
          hasError
            ? "border-red-400/70 focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
            : open
              ? "border-[#0369A1] ring-2 ring-[#0369A1]/20"
              : "border-[#E2E8F0] hover:border-[#83909D] focus:border-[#0369A1] focus:ring-2 focus:ring-[#0369A1]/20"
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          {selected ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[#1E293B]">{selected.label}</span>
              {selected.hint && (
                <span className="block truncate text-xs text-[#83909D]">{selected.hint}</span>
              )}
            </span>
          ) : (
            <span className="flex-1 truncate text-[#83909D]">{placeholder}</span>
          )}
          <ChevronDown
            size={16}
            className={`shrink-0 text-[#83909D] transition-transform duration-200 ${
              open ? "rotate-180 text-[#0369A1]" : ""
            }`}
          />
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div
          role="listbox"
          className="animate-dropdown-in absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-2xl shadow-black/10"
        >
          <div className="hide-scrollbar max-h-60 overflow-y-auto py-1.5">
            {options.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[#83909D]">No options available.</p>
            ) : (
              options.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "bg-[#0369A1]/10 text-[#0369A1]"
                        : "text-[#1E293B] hover:bg-[#0369A1]/10 hover:text-[#0369A1]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm font-medium ${
                          isSelected ? "text-[#0369A1]" : ""
                        }`}
                      >
                        {o.label}
                      </span>
                      {o.hint && (
                        <span className="block truncate text-xs text-[#83909D]">{o.hint}</span>
                      )}
                    </span>
                    {/* Check mark for the active option */}
                    {isSelected && (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0369A1]/15">
                        <Check size={12} className="text-[#0369A1]" />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
