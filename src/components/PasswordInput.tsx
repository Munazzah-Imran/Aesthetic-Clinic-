"use client";

import { useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Reusable password field with a show/hide eye icon inside the input.
 *
 * - `type` toggles between "password" and "text" via local state; the value
 *   itself is never touched, so controlled and uncontrolled usages keep their
 *   state, validation, autocomplete and submission behavior unchanged.
 * - Each instance owns its own visibility state, so toggling one field never
 *   reveals another.
 * - All other props (className, value, onChange, placeholder, autoComplete,
 *   minLength, required, id, name, ...) are forwarded to the underlying
 *   <input>, so the existing styling and validation are preserved as-is.
 * - Extra right padding (2.75rem, matching the 2.75rem-wide button) is applied
 *   inline so the icon never overlaps the typed text, regardless of the
 *   caller's padding utilities.
 */
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export default function PasswordInput({
  className,
  style,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Selection captured on mousedown (the input still has focus at that point)
  // so a toggle via mouse restores the caret exactly where it was.
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  function captureSelection() {
    const el = inputRef.current;
    if (!el || document.activeElement !== el) {
      selectionRef.current = null;
      return;
    }
    try {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      selectionRef.current =
        start != null && end != null ? { start, end } : null;
    } catch {
      selectionRef.current = null;
    }
  }

  function toggleVisibility() {
    const el = inputRef.current;
    const selection = selectionRef.current;
    selectionRef.current = null;
    setVisible((v) => !v);
    // Restore focus + caret only when the input had focus right before the
    // toggle, so typing position is never lost or moved unnecessarily.
    if (el && selection) {
      requestAnimationFrame(() => {
        el.focus({ preventScroll: true });
        try {
          el.setSelectionRange(selection.start, selection.end);
        } catch {
          /* selection not supported for this input — ignore */
        }
      });
    }
  }

  const mergedStyle: CSSProperties = { ...style, paddingRight: "2.75rem" };

  return (
    <div className="relative w-full">
      <input
        {...props}
        ref={inputRef}
        type={visible ? "text" : "password"}
        className={className}
        style={mergedStyle}
      />
      <button
        type="button"
        onClick={toggleVisibility}
        onMouseDown={captureSelection}
        onPointerDown={captureSelection}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center text-[#83909D] outline-none transition-colors hover:text-sky-600 focus-visible:text-sky-600 focus-visible:ring-2 focus-visible:ring-sky-500/30"
      >
        {visible ? (
          <EyeOff size={16} aria-hidden="true" />
        ) : (
          <Eye size={16} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
