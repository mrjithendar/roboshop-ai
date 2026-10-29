import { ImageResponse } from "next/og";
import { site } from "@/config/site";

export const ogSize = { width: 1200, height: 630 };

/** Branded 1200×630 social card. Rendered by next/og (Satori); no external fonts or images. */
export function ogCard({ eyebrow, title, footer, accent = "#2559c4", name = site.name }: { eyebrow: string; title: string; footer: string; accent?: string; name?: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0e1013",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            J
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>{name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#a5b4fc", textTransform: "uppercase", letterSpacing: 2 }}>{eyebrow}</div>
          <div style={{ fontSize: title.length > 70 ? 54 : 64, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1000 }}>{title}</div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#cbd5e1" }}>{footer}</div>
      </div>
    ),
    ogSize,
  );
}
