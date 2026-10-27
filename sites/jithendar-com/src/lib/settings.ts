import { z } from "zod";
import { broadcastInvalidate, onInvalidate } from "./cache-bus";

const httpsUrl = z.union([z.literal(""), z.url({ protocol: /^https$/ })]);

export const settingsSchema = z.object({
  siteName: z.string().trim().min(2).max(60),
  publicationName: z.string().trim().min(2).max(60),
  description: z.string().trim().min(50).max(200),
  hero: z.object({
    eyebrow: z.string().trim().max(60),
    title: z.string().trim().min(10).max(120),
    highlight: z.string().trim().max(60),
    subtitle: z.string().trim().min(20).max(300),
  }),
  features: z.object({
    comments: z.boolean(),
    registration: z.boolean(),
    contactForm: z.boolean(),
  }),
  social: z.object({ github: httpsUrl, x: httpsUrl, linkedin: httpsUrl }),
  announcement: z.object({ enabled: z.boolean(), text: z.string().trim().max(200), href: z.string().trim().max(300) }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  siteName: "Jithendar.com",
  publicationName: "Jithendar.com",
  description:
    "Engineering notes, news and analysis on AI engineering, cloud, Kubernetes, platform engineering, infrastructure as code and security.",
  hero: {
    eyebrow: "Independent engineering publication",
    title: "Engineering insight for teams building with",
    highlight: "AI, cloud and Kubernetes",
    subtitle:
      "Sourced news, in-depth analysis and hands-on tutorials across AI engineering, platform engineering, infrastructure as code and security. Every article is reviewed by a human editor.",
  },
  features: { comments: true, registration: true, contactForm: true },
  social: { github: "https://github.com/mrjithendar", x: "https://x.com/imjithendar", linkedin: "https://www.linkedin.com/in/jithendardharmapuri" },
  announcement: { enabled: false, text: "", href: "" },
};

const SETTINGS_KEY = "site";
const TTL_MS = 30_000;
let cached: { value: Settings; at: number } | undefined;
onInvalidate("settings", () => {
  cached = undefined;
});

/** Stored settings merged over defaults; falls back to defaults if the database is unavailable (e.g. at build time). */
export async function getSettings(): Promise<Settings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let stored: unknown = {};
  try {
    const { getDb, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, SETTINGS_KEY));
    stored = row?.value ?? {};
  } catch {
    return defaultSettings;
  }
  const merged = mergeSettings(stored);
  cached = { value: merged, at: Date.now() };
  return merged;
}

/** Deep-merge a partial stored value over defaults; invalid stored values fall back to defaults. */
export function mergeSettings(stored: unknown): Settings {
  const s = (stored ?? {}) as Partial<Settings>;
  const candidate = {
    ...defaultSettings,
    ...s,
    hero: { ...defaultSettings.hero, ...s.hero },
    features: { ...defaultSettings.features, ...s.features },
    social: { ...defaultSettings.social, ...s.social },
    announcement: { ...defaultSettings.announcement, ...s.announcement },
  };
  const parsed = settingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : defaultSettings;
}

export async function saveSettings(value: Settings, userId: string) {
  const { getDb, schema } = await import("@/db");
  const parsed = settingsSchema.parse(value);
  const db = await getDb();
  await db
    .insert(schema.setting)
    .values({ key: SETTINGS_KEY, value: parsed, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: parsed, updatedBy: userId, updatedAt: new Date() } });
  broadcastInvalidate("settings");
}
