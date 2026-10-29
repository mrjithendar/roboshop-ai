"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Accessible modal: full-screen sheet on phones, centred panel from `sm` up. Escape and the close
 * button call onClose; focus moves into the dialog, stays there (Tab wraps) and returns to the
 * element that opened it; the page behind does not scroll.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter(
        (el) => el.offsetParent !== null,
      );
    (focusables().find((el) => el.dataset.autofocus !== undefined) ?? focusables()[0] ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex h-dvh w-full flex-col overflow-hidden bg-surface shadow-xl sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl ${size === "md" ? "sm:max-w-2xl" : "sm:max-w-4xl"}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-6 sm:py-4">
          <h2 id={titleId} className="font-semibold text-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-surface-sunken hover:text-fg"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-4 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}
