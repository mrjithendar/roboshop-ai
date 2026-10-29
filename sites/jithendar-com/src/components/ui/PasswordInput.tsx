"use client";

import { useEffect, useRef, useState, type ComponentProps, type Ref } from "react";
import { flushSync } from "react-dom";
import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { inputClass } from "./form";

/**
 * A password field with a show/hide toggle. Hidden by default; each field has its own toggle.
 * - The toggle is `type="button"`, so it never submits the form, and is labelled "Show password" / "Hide password".
 * - Clicking it keeps focus and the cursor/selection in the field (mouse down does not steal focus, and the
 *   selection is restored after the type changes); keyboard users stay on the toggle.
 * - The field goes back to hidden when its form is submitted, so browsers and password managers see a normal
 *   password field when they offer to save it. `autoComplete`, `name`, validation attributes pass through.
 * The value lives only in the input; nothing is logged or stored.
 */
export function PasswordInput({ className = "", ref, ...props }: Omit<ComponentProps<"input">, "type"> & { ref?: Ref<HTMLInputElement> }) {
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    // Capture phase: runs before the form's own submit handlers.
    const hide = () => flushSync(() => setVisible(false));
    form.addEventListener("submit", hide, true);
    return () => form.removeEventListener("submit", hide, true);
  }, []);

  function toggle() {
    const el = input.current;
    const focused = !!el && document.activeElement === el;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    const direction = el?.selectionDirection ?? undefined;
    flushSync(() => setVisible((v) => !v));
    if (el && focused && start !== null && end !== null) {
      el.focus();
      el.setSelectionRange(start, end, direction);
    }
  }

  const setRef = (el: HTMLInputElement | null) => {
    input.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  return (
    <div className="relative">
      <input
        {...props}
        ref={setRef}
        type={visible ? "text" : "password"}
        // Spellcheck/autocapitalize would send or alter the visible password.
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        className={`${inputClass} pr-12 ${className}`}
      />
      <button
        type="button"
        onClick={toggle}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-controls={props.id}
        title={visible ? "Hide password" : "Show password"}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--radius-control)] text-fg-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
      </button>
    </div>
  );
}
