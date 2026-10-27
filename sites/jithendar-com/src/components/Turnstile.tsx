"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
  return new Promise((resolve, reject) => {
    const script = existing ?? Object.assign(document.createElement("script"), { src: SCRIPT, async: true, defer: true });
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
    if (!existing) document.head.appendChild(script);
  });
}

/**
 * Cloudflare Turnstile human check. Loaded only on pages with forms (login, contact, comments),
 * never on article reading pages. Calls onToken(null) when the token expires.
 */
export function Turnstile({ siteKey, onToken, resetKey = 0 }: { siteKey: string; onToken: (token: string | null) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  useLayoutEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widget.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: "auto",
          callback: (t: string) => callback.current(t),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, resetKey]);

  return <div ref={ref} className="min-h-[65px]" />;
}
