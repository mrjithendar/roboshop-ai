"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isTrackablePath } from "@/config/integrations";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * One responsive AdSense unit in a box that reserves its space (no layout shift when the ad arrives),
 * clearly labelled "Advertisement". Requested once per mount; never refreshed. Outside production
 * it requests Google test ads (data-adtest="on"), which do not generate real impressions.
 */
export function AdSlot({ client, slot, test, minHeight = 280 }: { client: string; slot: string; test: boolean; minHeight?: number }) {
  const pathname = usePathname();
  const ins = useRef<HTMLModElement>(null);
  const pushed = useRef(false);
  useEffect(() => {
    if (pushed.current || !ins.current || ins.current.dataset.adsbygoogleStatus) return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* blocked or not loaded: the reserved box simply stays empty */
    }
  }, []);
  if (!isTrackablePath(pathname)) return null;
  return (
    <aside aria-label="Advertisement" className="my-10 border-y border-slate-200 py-3 dark:border-white/10">
      <p className="mb-2 text-center text-[11px] uppercase tracking-wider text-slate-400">Advertisement</p>
      <div style={{ minHeight }} className="w-full overflow-hidden">
        <ins
          ref={ins}
          className="adsbygoogle"
          style={{ display: "block", minHeight }}
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
          {...(test ? { "data-adtest": "on" } : {})}
        />
      </div>
    </aside>
  );
}
