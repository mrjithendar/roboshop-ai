"use client";

import { useEffect, useState } from "react";

type GoogleFc = { callbackQueue: (Record<string, () => void> | (() => void))[]; showRevocationMessage?: () => void };

/**
 * "Privacy choices" link: reopens Google's consent message (googlefc.showRevocationMessage) so visitors
 * can change or withdraw consent. Shown only once Google's consent API is ready (it is not available
 * outside regions where the message applies, or when it is blocked), so it never renders a dead link.
 */
export function PrivacyChoices({ className = "" }: { className?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as unknown as { googlefc?: GoogleFc };
    w.googlefc = w.googlefc || ({ callbackQueue: [] } as GoogleFc);
    w.googlefc.callbackQueue = w.googlefc.callbackQueue || [];
    w.googlefc.callbackQueue.push({ CONSENT_API_READY: () => setReady(true) });
  }, []);
  if (!ready) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => (window as unknown as { googlefc?: GoogleFc }).googlefc?.showRevocationMessage?.()}
    >
      Privacy choices
    </button>
  );
}
