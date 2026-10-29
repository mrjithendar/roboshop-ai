/**
 * Site configuration: every admin-customisable aspect of the public site, as one typed, versioned document.
 * Isomorphic (used by the admin UI for instant validation and by the server, which is authoritative).
 *
 * Safety model: no free-form HTML, JavaScript or style strings reach pages. Text is plain (React escapes it),
 * links are same-site paths or https URLs, colours are #rrggbb, sizes are enumerations or bounded integers,
 * images are references to our own media. The only CSS an admin can write is the restricted custom CSS
 * field (validated in css.ts).
 */
import { z } from "zod";
import { AA, contrast, HEX, overlayContrast, readableOn } from "./color";
import { checkCustomCss } from "./css";

export const SCHEMA_VERSION = 1;

// --- Primitives ------------------------------------------------------------------------------------------

/** Control characters and bidi overrides are never allowed in configured text (they can disguise content). */
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/;
export const text = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min, min > 0 ? `Enter at least ${min} characters.` : undefined)
    .max(max, `Use at most ${max} characters.`)
    .refine((v) => !UNSAFE_TEXT.test(v.replace(/[\n\t]/g, "")), "Contains characters that are not allowed.");

/** Routes a menu or button may never point at (they are private or machine endpoints). */
const PRIVATE_PATH = /^\/(admin|api|setup|preview)(\/|$|\?|#)/;

/**
 * A link destination: a same-site path ("/blog", "/about#team") or an https URL. Everything else
 * (javascript:, data:, protocol-relative //host, backslashes, whitespace) is refused.
 */
export function safeHref(value: string): string | null {
  const v = value.trim();
  if (!v || v.length > 300 || /[\s\\<>"']/.test(v) || UNSAFE_TEXT.test(v)) return null;
  if (v.startsWith("/")) {
    if (v.startsWith("//") || PRIVATE_PATH.test(v)) return null;
    return v;
  }
  if (v.startsWith("mailto:")) return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
  try {
    const url = new URL(v);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const href = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const safe = safeHref(v);
    if (!safe) {
      ctx.addIssue({ code: "custom", message: "Use a site path like /blog or an https:// link." });
      return z.NEVER;
    }
    return safe;
  });

const optionalHref = z.union([z.literal(""), href]);
const httpsOrEmpty = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .refine((v) => safeHref(v)?.startsWith("https://") ?? false, "Use an https:// link."),
]);

export const hex = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX, "Use a colour like #1f6feb.");

/** Our own images only: uploads served from /media/{id}/{name} or files shipped under /images/. */
const IMAGE_SRC = /^\/(media\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}|images\/[A-Za-z0-9/_.-]{1,200})$/;

export const imageRef = z
  .object({
    src: z.string().regex(IMAGE_SRC, "Choose an image from the media library."),
    width: z.number().int().min(1).max(12_000),
    height: z.number().int().min(1).max(12_000),
    alt: text(300),
    /** Decorative images get alt="" and are hidden from assistive technology. */
    decorative: z.boolean(),
    focalX: z.number().int().min(0).max(100),
    focalY: z.number().int().min(0).max(100),
    fit: z.enum(["cover", "contain"]),
  })
  .refine((i) => i.decorative || i.alt.length > 0, { message: "Describe the image (alt text) or mark it as decorative.", path: ["alt"] });
export type ImageRef = z.infer<typeof imageRef>;

/** A background/banner image: desktop and optional mobile crops, overlay for text legibility, bounded height. */
export const banner = z.object({
  desktop: imageRef.nullable(),
  mobile: imageRef.nullable(),
  overlayColor: hex,
  overlayOpacity: z.number().int().min(0).max(90),
  height: z.enum(["sm", "md", "lg"]),
});
export type Banner = z.infer<typeof banner>;

const emptyBanner = (): Banner => ({ desktop: null, mobile: null, overlayColor: "#0b1220", overlayOpacity: 60, height: "md" });

// --- Sections of the document --------------------------------------------------------------------------

export const TIMEZONES = [
  "Asia/Kolkata", "UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Asia/Singapore", "Asia/Dubai", "Asia/Tokyo", "Australia/Sydney",
] as const;
export const DATE_FORMATS = { "d-mmm-yyyy": "29 Oct 2026", "mmm-d-yyyy": "Oct 29, 2026", "d-mmmm-yyyy": "29 October 2026", iso: "2026-10-29" } as const;

const general = z.object({
  siteName: text(60, 2),
  publicationName: text(60, 2),
  tagline: text(80),
  description: text(200, 50),
  timezone: z.enum(TIMEZONES),
  dateFormat: z.enum(Object.keys(DATE_FORMATS) as [keyof typeof DATE_FORMATS, ...(keyof typeof DATE_FORMATS)[]]),
  contact: z.object({ email: z.union([z.literal(""), z.email("Enter a valid email address.").max(200)]), location: text(80) }),
  social: z.object({ github: httpsOrEmpty, x: httpsOrEmpty, linkedin: httpsOrEmpty, youtube: httpsOrEmpty, mastodon: httpsOrEmpty }),
  features: z.object({ comments: z.boolean(), registration: z.boolean(), contactForm: z.boolean() }),
  maintenance: z.object({ enabled: z.boolean(), message: text(300), retryAfterMinutes: z.number().int().min(5).max(1440) }),
});

const branding = z.object({
  showWordmark: z.boolean(),
  logoLight: imageRef.nullable(),
  logoDark: imageRef.nullable(),
  logoMobile: imageRef.nullable(),
  favicon: imageRef.nullable(),
  appleIcon: imageRef.nullable(),
  socialImage: imageRef.nullable(),
});

const header = z.object({
  preset: z.enum(["standard", "centered", "minimal", "accent"]),
  width: z.enum(["contained", "full"]),
  height: z.enum(["compact", "regular", "tall"]),
  sticky: z.boolean(),
  navAlign: z.enum(["start", "center", "end"]),
  logoSize: z.enum(["sm", "md", "lg"]),
  background: z.enum(["canvas", "muted", "accent", "image"]),
  image: banner,
  showSearch: z.boolean(),
  showThemeToggle: z.boolean(),
  showAccount: z.boolean(),
  showSocial: z.boolean(),
  cta: z.object({ show: z.boolean(), label: text(24), href: optionalHref }),
  announcement: z.object({
    enabled: z.boolean(),
    text: text(200),
    href: optionalHref,
    dismissible: z.boolean(),
    tone: z.enum(["neutral", "accent", "warning"]),
  }),
});

const id = z.string().regex(/^[a-z0-9-]{1,40}$/, "Invalid id.");
const menuLeaf = z.object({ id, label: text(40, 1), href, newTab: z.boolean(), children: z.array(z.never()).max(0) });
const menuItem = z.object({ id, label: text(40, 1), href, newTab: z.boolean(), children: z.array(menuLeaf).max(8, "At most 8 sub-items.") });
export type MenuItem = z.infer<typeof menuItem>;

const navigation = z.object({
  menus: z
    .array(z.object({ id, name: text(40, 1), items: z.array(menuItem).max(12, "At most 12 items per menu.") }))
    .min(1)
    .max(8),
  /** Which menu the header shows (top level ≤ 8 items, one level of children). */
  headerMenu: id,
});

const footerColumn = z.object({
  id,
  title: text(40, 1),
  source: z.enum(["menu", "topics"]),
  menuId: z.union([z.literal(""), id]),
});

const footer = z.object({
  preset: z.enum(["columns", "simple", "centered"]),
  columns: z.array(footerColumn).max(4, "At most 4 columns."),
  showLogo: z.boolean(),
  description: text(300),
  showSocial: z.boolean(),
  showRss: z.boolean(),
  showContact: z.boolean(),
  copyright: text(160),
  background: z.enum(["muted", "canvas", "inverted", "image"]),
  image: banner,
  align: z.enum(["start", "center"]),
  spacing: z.enum(["compact", "regular", "spacious"]),
});

export const BODY_FONTS = {
  inter: "Inter",
  "ibm-plex-sans": "IBM Plex Sans",
  "source-sans": "Source Sans 3",
  "source-serif": "Source Serif 4",
} as const;
export const CODE_FONTS = { "jetbrains-mono": "JetBrains Mono", "ibm-plex-mono": "IBM Plex Mono" } as const;
type Keys<T> = [keyof T & string, ...(keyof T & string)[]];
const bodyFont = z.enum(Object.keys(BODY_FONTS) as Keys<typeof BODY_FONTS>);
const codeFont = z.enum(Object.keys(CODE_FONTS) as Keys<typeof CODE_FONTS>);

const palette = z.object({
  canvas: hex,
  surface: hex,
  text: hex,
  muted: hex,
  subtle: hex,
  border: hex,
  accent: hex,
  link: hex,
});
export type Palette = z.infer<typeof palette>;

const theme = z.object({
  fonts: z.object({ body: bodyFont, heading: bodyFont, code: codeFont }),
  textScale: z.union([z.literal(100), z.literal(106), z.literal(112)]),
  headingWeight: z.union([z.literal(600), z.literal(700), z.literal(800)]),
  bodyLineHeight: z.number().min(1.5).max(1.9),
  light: palette,
  dark: palette,
  contentWidth: z.number().int().min(64).max(88),
  readingWidth: z.number().int().min(36).max(50),
  density: z.enum(["compact", "comfortable", "spacious"]),
  radius: z.enum(["none", "small", "medium", "large"]),
  buttonShape: z.enum(["rounded", "pill", "square"]),
  defaultMode: z.enum(["system", "light", "dark"]),
});

// Homepage sections: a registry of approved components, each with its own typed props.
const sectionBase = { id, hidden: z.boolean(), spacing: z.enum(["sm", "md", "lg"]), background: z.enum(["none", "muted", "accent"]) };
const link = z.object({ label: text(40), href: optionalHref });

export const SECTION_TYPES = {
  hero: "Introduction",
  latest: "Latest articles",
  featured: "Hand-picked articles",
  topics: "Topics",
  projects: "Projects",
  principles: "Editorial standards",
  author: "Author bio",
  cta: "Call to action",
  text: "Text block",
} as const;

const sectionSchema = z.discriminatedUnion("type", [
  z.object({
    ...sectionBase,
    type: z.literal("hero"),
    eyebrow: text(60),
    heading: text(120, 5),
    highlight: text(60),
    subtitle: text(300),
    primary: link,
    secondary: link,
    layout: z.enum(["text", "split", "banner"]),
    align: z.enum(["start", "center"]),
    image: banner,
  }),
  z.object({
    ...sectionBase,
    type: z.literal("latest"),
    heading: text(80),
    description: text(200),
    layout: z.enum(["featured-grid", "grid", "list"]),
    count: z.number().int().min(1).max(12),
    collections: z.array(z.enum(["blog", "news", "projects"])).min(1).max(3),
    showViewAll: z.boolean(),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("featured"),
    heading: text(80),
    description: text(200),
    layout: z.enum(["grid", "list"]),
    paths: z.array(z.string().regex(/^\/(blog|news|projects)\/[a-z0-9-]{1,120}$/)).max(6),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("topics"),
    heading: text(80),
    description: text(200),
    layout: z.enum(["cards", "compact"]),
    categories: z.array(z.string().regex(/^[a-z0-9-]{1,60}$/)).max(16),
  }),
  z.object({ ...sectionBase, type: z.literal("projects"), heading: text(80), description: text(200), count: z.number().int().min(1).max(6) }),
  z.object({
    ...sectionBase,
    type: z.literal("principles"),
    heading: text(80),
    description: text(200),
    items: z.array(z.object({ title: text(60, 1), text: text(200), link })).min(1).max(4),
  }),
  z.object({
    ...sectionBase,
    type: z.literal("author"),
    eyebrow: text(40),
    author: z.string().regex(/^[a-z0-9-]{1,80}$/),
    text: text(400),
    showLinks: z.boolean(),
  }),
  z.object({ ...sectionBase, type: z.literal("cta"), heading: text(80, 1), text: text(300), primary: link, secondary: link }),
  z.object({ ...sectionBase, type: z.literal("text"), heading: text(80), body: text(2000, 1) }),
]);
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section["type"];

const homepage = z.object({ sections: z.array(sectionSchema).max(16, "At most 16 sections.") });

const blog = z.object({
  listing: z.object({
    layout: z.enum(["grid", "list"]),
    columns: z.union([z.literal(2), z.literal(3)]),
    pageSize: z.number().int().min(6).max(24),
    excerptLines: z.number().int().min(0).max(4),
    coverAspect: z.enum(["16/9", "3/2", "4/3", "1/1", "none"]),
    showDate: z.boolean(),
    showReadingTime: z.boolean(),
    showCategory: z.boolean(),
    showType: z.boolean(),
  }),
  article: z.object({
    width: z.enum(["narrow", "default", "wide"]),
    bodySize: z.union([z.literal(16), z.literal(17), z.literal(18), z.literal(19)]),
    showBreadcrumbs: z.boolean(),
    showAuthor: z.boolean(),
    showUpdated: z.boolean(),
    showReadingTime: z.boolean(),
    showCover: z.boolean(),
    toc: z.object({ enabled: z.boolean(), minHeadings: z.number().int().min(2).max(8) }),
    related: z.object({ enabled: z.boolean(), count: z.number().int().min(1).max(6) }),
    sidebar: z.enum(["toc", "none"]),
    share: z.object({ enabled: z.boolean(), networks: z.array(z.enum(["x", "linkedin", "email", "copy"])).max(4) }),
    showAuthorCard: z.boolean(),
  }),
});

const media = z.object({
  imageRadius: z.enum(["none", "small", "medium"]),
  captionAlign: z.enum(["center", "start"]),
  galleryColumns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
});

const seo = z.object({
  titleSeparator: z.enum(["|", "·", "—", "-"]),
  homeTitle: text(70, 10),
});

const advanced = z.object({ customCss: z.object({ enabled: z.boolean(), css: z.string().max(10_000) }) });

const base = z.object({
  general,
  branding,
  header,
  navigation,
  footer,
  theme,
  homepage,
  blog,
  media,
  seo,
  advanced,
});

/** Cross-field rules that keep the site usable and readable. */
export const siteConfigSchema = base.superRefine((c, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

  for (const mode of ["light", "dark"] as const) {
    const p = c.theme[mode];
    const checks: [keyof Palette, string, string][] = [
      ["text", p.canvas, "Body text"],
      ["muted", p.canvas, "Secondary text"],
      ["subtle", p.canvas, "Meta text"],
      ["link", p.canvas, "Links"],
    ];
    for (const [key, bg, label] of checks) {
      const ratio = contrast(p[key], bg);
      if (ratio < AA) issue(["theme", mode, key], `${label} contrast is ${ratio.toFixed(2)}:1 on the page background; at least 4.5:1 is required.`);
    }
    if (contrast(p.text, p.surface) < AA) issue(["theme", mode, "surface"], "Body text must have at least 4.5:1 contrast on cards.");
    if (contrast(readableOn(p.accent), p.accent) < AA) issue(["theme", mode, "accent"], "Button text cannot reach 4.5:1 on this accent colour.");
  }

  const menus = new Map(c.navigation.menus.map((m) => [m.id, m]));
  if (menus.size !== c.navigation.menus.length) issue(["navigation", "menus"], "Menu ids must be unique.");
  const headerMenu = menus.get(c.navigation.headerMenu);
  if (!headerMenu) issue(["navigation", "headerMenu"], "Choose the menu shown in the header.");
  else if (headerMenu.items.length === 0) issue(["navigation", "headerMenu"], "The header menu needs at least one item, or readers cannot navigate.");
  else if (headerMenu.items.length > 8) issue(["navigation", "headerMenu"], "The header menu can show at most 8 top-level items.");
  for (const [i, col] of c.footer.columns.entries()) {
    if (col.source === "menu" && !menus.has(col.menuId)) issue(["footer", "columns", i, "menuId"], "Choose a menu for this column.");
  }

  if (c.header.cta.show && (!c.header.cta.label || !c.header.cta.href)) issue(["header", "cta"], "A header button needs a label and a link.");
  if (c.header.announcement.enabled && !c.header.announcement.text) issue(["header", "announcement", "text"], "Enter the announcement text.");

  const bannerRules: [Banner, (string | number)[], boolean][] = [
    [c.header.image, ["header", "image"], c.header.background === "image"],
    [c.footer.image, ["footer", "image"], c.footer.background === "image"],
  ];
  for (const [i, s] of c.homepage.sections.entries()) {
    if (s.type === "hero" && s.layout === "banner") bannerRules.push([s.image, ["homepage", "sections", i, "image"], true]);
  }
  for (const [b, path, used] of bannerRules) {
    if (!used) continue;
    if (!b.desktop) issue([...path, "desktop"], "Choose an image, or pick a different background.");
    const ratio = overlayContrast("#ffffff", b.overlayColor, b.overlayOpacity);
    if (ratio < AA) issue([...path, "overlayOpacity"], `Text over this image could drop to ${ratio.toFixed(2)}:1. Use a darker overlay or a higher opacity.`);
  }

  if (c.advanced.customCss.enabled) {
    for (const problem of checkCustomCss(c.advanced.customCss.css)) issue(["advanced", "customCss", "css"], problem);
  }

  const sectionIds = new Set<string>();
  for (const [i, s] of c.homepage.sections.entries()) {
    if (sectionIds.has(s.id)) issue(["homepage", "sections", i, "id"], "Section ids must be unique.");
    sectionIds.add(s.id);
  }
});

export type SiteConfig = z.infer<typeof base>;

// --- Defaults (the current site design) ------------------------------------------------------------------

export const DEFAULT_LIGHT: Palette = {
  canvas: "#ffffff",
  surface: "#ffffff",
  text: "#17191d",
  muted: "#4a4f57",
  subtle: "#666c75",
  border: "#e3e5e8",
  accent: "#2559c4",
  link: "#204a9f",
};
export const DEFAULT_DARK: Palette = {
  canvas: "#0e1013",
  surface: "#16181c",
  text: "#f2f3f5",
  muted: "#c9ccd1",
  subtle: "#a3a8b0",
  border: "#2a2d33",
  accent: "#6c9bf2",
  link: "#a1bdf4",
};

const principles = [
  { title: "Human-reviewed", text: "An editor reviews and approves every article before it is published.", link: { label: "Editorial policy", href: "/editorial-policy" } },
  { title: "Sourced", text: "News and summaries cite their sources, listed at the end of each article.", link: { label: "How we source", href: "/editorial-policy" } },
  { title: "Corrected in the open", text: "Errors are fixed promptly, with a dated note on the article.", link: { label: "Corrections policy", href: "/corrections-policy" } },
  { title: "Transparent about AI", text: "AI may assist with discovery and drafts. It never publishes on its own.", link: { label: "AI use policy", href: "/ai-use-policy" } },
];

export function defaultConfig(): SiteConfig {
  return {
    general: {
      siteName: "Jithendar.com",
      publicationName: "Jithendar.com",
      tagline: "Engineering insight on AI, cloud and Kubernetes",
      description:
        "Engineering notes, news and analysis on AI engineering, cloud, Kubernetes, platform engineering, infrastructure as code and security.",
      timezone: "Asia/Kolkata",
      dateFormat: "d-mmm-yyyy",
      contact: { email: "", location: "" },
      social: { github: "https://github.com/mrjithendar", x: "https://x.com/imjithendar", linkedin: "https://www.linkedin.com/in/jithendardharmapuri", youtube: "", mastodon: "" },
      features: { comments: true, registration: true, contactForm: true },
      maintenance: { enabled: false, message: "We are making improvements and will be back shortly.", retryAfterMinutes: 30 },
    },
    branding: { showWordmark: true, logoLight: null, logoDark: null, logoMobile: null, favicon: null, appleIcon: null, socialImage: null },
    header: {
      preset: "standard",
      width: "contained",
      height: "regular",
      sticky: true,
      navAlign: "start",
      logoSize: "md",
      background: "canvas",
      image: emptyBanner(),
      showSearch: true,
      showThemeToggle: true,
      showAccount: true,
      showSocial: false,
      cta: { show: false, label: "", href: "" },
      announcement: { enabled: false, text: "", href: "", dismissible: true, tone: "neutral" },
    },
    navigation: {
      menus: [
        {
          id: "main",
          name: "Main menu",
          items: [
            { id: "articles", label: "Articles", href: "/blog", newTab: false, children: [] },
            { id: "news", label: "News", href: "/news", newTab: false, children: [] },
            { id: "projects", label: "Projects", href: "/projects", newTab: false, children: [] },
            { id: "about", label: "About", href: "/about", newTab: false, children: [] },
          ],
        },
        {
          id: "publication",
          name: "Publication",
          items: [
            { id: "f-articles", label: "Articles", href: "/blog", newTab: false, children: [] },
            { id: "f-news", label: "News", href: "/news", newTab: false, children: [] },
            { id: "f-projects", label: "Projects", href: "/projects", newTab: false, children: [] },
            { id: "f-search", label: "Search", href: "/search", newTab: false, children: [] },
          ],
        },
        {
          id: "info",
          name: "Publication info",
          items: [
            { id: "i-about", label: "About", href: "/about", newTab: false, children: [] },
            { id: "i-contact", label: "Contact", href: "/contact", newTab: false, children: [] },
            { id: "i-author", label: "Author", href: "/authors/jithendar-dharmapuri", newTab: false, children: [] },
          ],
        },
      ],
      headerMenu: "main",
    },
    footer: {
      preset: "columns",
      columns: [
        { id: "publication", title: "Publication", source: "menu", menuId: "publication" },
        { id: "topics", title: "Topics", source: "topics", menuId: "" },
        { id: "info", title: "Publication info", source: "menu", menuId: "info" },
      ],
      showLogo: true,
      description: "",
      showSocial: true,
      showRss: true,
      showContact: false,
      copyright: "© {year} {site}. Every article is reviewed by a human editor.",
      background: "muted",
      image: emptyBanner(),
      align: "start",
      spacing: "regular",
    },
    theme: {
      fonts: { body: "inter", heading: "inter", code: "jetbrains-mono" },
      textScale: 100,
      headingWeight: 700,
      bodyLineHeight: 1.75,
      light: { ...DEFAULT_LIGHT },
      dark: { ...DEFAULT_DARK },
      contentWidth: 76,
      readingWidth: 43,
      density: "comfortable",
      radius: "medium",
      buttonShape: "rounded",
      defaultMode: "system",
    },
    homepage: {
      sections: [
        {
          id: "intro",
          type: "hero",
          hidden: false,
          spacing: "lg",
          background: "none",
          eyebrow: "Independent engineering publication",
          heading: "Engineering insight for teams building with",
          highlight: "AI, cloud and Kubernetes",
          subtitle:
            "Sourced news, in-depth analysis and hands-on tutorials across AI engineering, platform engineering, infrastructure as code and security. Every article is reviewed by a human editor.",
          primary: { label: "Read the latest articles", href: "/blog" },
          secondary: { label: "About the publication", href: "/about" },
          layout: "text",
          align: "start",
          image: emptyBanner(),
        },
        { id: "latest", type: "latest", hidden: false, spacing: "md", background: "none", heading: "Latest writing", description: "", layout: "featured-grid", count: 7, collections: ["blog", "news"], showViewAll: true },
        {
          id: "topics",
          type: "topics",
          hidden: false,
          spacing: "md",
          background: "none",
          heading: "Topics",
          description: "Eight areas where engineering teams make the decisions that matter most right now.",
          layout: "cards",
          categories: [],
        },
        { id: "projects", type: "projects", hidden: false, spacing: "md", background: "none", heading: "Projects", description: "Systems the editor has built, and how they work.", count: 3 },
        {
          id: "standards",
          type: "principles",
          hidden: false,
          spacing: "md",
          background: "none",
          heading: "How every article is made",
          description: "The rules behind the publication, so you know what you can rely on.",
          items: principles,
        },
        {
          id: "editor",
          type: "author",
          hidden: false,
          spacing: "md",
          background: "none",
          eyebrow: "Editor",
          author: "jithendar-dharmapuri",
          text: "Writes and edits Jithendar.com and builds the systems behind it, including RoboShop AI, a public microservices storefront with an AI shopping assistant, deployed on Kubernetes.",
          showLinks: true,
        },
      ],
    },
    blog: {
      listing: { layout: "grid", columns: 3, pageSize: 12, excerptLines: 3, coverAspect: "16/9", showDate: true, showReadingTime: true, showCategory: true, showType: true },
      article: {
        width: "default",
        bodySize: 18,
        showBreadcrumbs: true,
        showAuthor: true,
        showUpdated: true,
        showReadingTime: true,
        showCover: true,
        toc: { enabled: true, minHeadings: 2 },
        related: { enabled: true, count: 3 },
        sidebar: "toc",
        share: { enabled: false, networks: ["x", "linkedin", "email", "copy"] },
        showAuthorCard: true,
      },
    },
    media: { imageRadius: "small", captionAlign: "center", galleryColumns: 3 },
    seo: { titleSeparator: "|", homeTitle: "Jithendar.com: engineering insight on AI, cloud and Kubernetes" },
    advanced: { customCss: { enabled: false, css: "" } },
  };
}

// --- Parsing, migration and safe fallbacks -------------------------------------------------------------

/** Keys that could pollute prototypes if an imported object were merged naively. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function hasForbiddenKeys(value: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKeys(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.keys(value).some((k) => FORBIDDEN_KEYS.has(k) || hasForbiddenKeys((value as Record<string, unknown>)[k], depth + 1));
  }
  return false;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep merge of plain objects (arrays replace). Only keys present in `base` are taken from `over`. */
function mergeKnown<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base)) {
    if (FORBIDDEN_KEYS.has(key) || !Object.hasOwn(over, key)) continue;
    out[key] = mergeKnown((base as Record<string, unknown>)[key], over[key]);
  }
  return out as T;
}

/** Upgrade a stored document from an older schema version (v0 = the flat legacy `setting.site` row). */
export function migrate(raw: unknown, fromVersion: number): unknown {
  if (fromVersion >= SCHEMA_VERSION || !isPlainObject(raw)) return raw;
  if (fromVersion === 0) {
    const legacy = raw as {
      siteName?: string; publicationName?: string; description?: string;
      hero?: { eyebrow?: string; title?: string; highlight?: string; subtitle?: string };
      features?: Record<string, boolean>; social?: Record<string, string>;
      announcement?: { enabled?: boolean; text?: string; href?: string };
    };
    const d = defaultConfig();
    const hero = d.homepage.sections[0] as Extract<Section, { type: "hero" }>;
    const sections = [{ ...hero, ...(legacy.hero?.eyebrow !== undefined ? { eyebrow: legacy.hero.eyebrow } : {}), ...(legacy.hero?.title ? { heading: legacy.hero.title } : {}), ...(legacy.hero?.highlight !== undefined ? { highlight: legacy.hero.highlight } : {}), ...(legacy.hero?.subtitle ? { subtitle: legacy.hero.subtitle } : {}) }, ...d.homepage.sections.slice(1)];
    return {
      general: { siteName: legacy.siteName, publicationName: legacy.publicationName, description: legacy.description, features: legacy.features, social: legacy.social },
      header: { announcement: { enabled: legacy.announcement?.enabled, text: legacy.announcement?.text, href: legacy.announcement?.href } },
      homepage: { sections },
    };
  }
  return raw;
}

/** Migrate, then fill missing fields from the defaults (no validation). */
export function mergeWithDefaults(raw: unknown, fromVersion = SCHEMA_VERSION): unknown {
  if (hasForbiddenKeys(raw)) return {};
  return mergeKnown(defaultConfig(), migrate(raw, fromVersion));
}

/**
 * Parse a stored or imported document into a complete, valid config. Partial documents are filled from
 * defaults section by section; a section that fails validation falls back to its default (the rest is kept),
 * so one bad value can never take the site down.
 */
export function normalizeConfig(raw: unknown, fromVersion = SCHEMA_VERSION): { config: SiteConfig; fallbacks: string[] } {
  const d = defaultConfig();
  if (hasForbiddenKeys(raw)) return { config: d, fallbacks: ["(document)"] };
  const migrated = migrate(raw, fromVersion);
  const merged = mergeKnown(d, migrated);
  const strict = siteConfigSchema.safeParse(merged);
  if (strict.success) return { config: strict.data, fallbacks: [] };
  const fallbacks: string[] = [];
  const repaired = { ...merged } as Record<string, unknown>;
  for (const key of Object.keys(d) as (keyof SiteConfig)[]) {
    const shape = base.shape[key];
    if (!shape.safeParse(repaired[key]).success) {
      repaired[key] = d[key];
      fallbacks.push(key);
    }
  }
  const second = siteConfigSchema.safeParse(repaired);
  if (second.success) return { config: second.data, fallbacks };
  // Cross-field rule still failing (e.g. header menu removed): fall back on the sections involved.
  for (const issue of second.error.issues) {
    const key = issue.path[0] as keyof SiteConfig;
    if (key in d && !fallbacks.includes(key)) {
      repaired[key] = d[key];
      fallbacks.push(key);
    }
  }
  const third = siteConfigSchema.safeParse(repaired);
  return third.success ? { config: third.data, fallbacks } : { config: d, fallbacks: ["(document)"] };
}

/** Strict validation for saving and publishing: returns readable issues with their paths. */
export function validateConfig(value: unknown): { ok: true; config: SiteConfig } | { ok: false; issues: { path: string; message: string }[] } {
  if (hasForbiddenKeys(value)) return { ok: false, issues: [{ path: "", message: "The document contains forbidden keys." }] };
  const parsed = siteConfigSchema.safeParse(value);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

// --- Presets ----------------------------------------------------------------------------------------------

export const THEME_PRESETS: Record<string, { label: string; description: string; theme: Partial<SiteConfig["theme"]> }> = {
  default: { label: "Default", description: "Neutral greys, a deep blue accent, Inter.", theme: defaultConfig().theme },
  editorial: {
    label: "Editorial",
    description: "Serif headings and a warm ink accent for long reads.",
    theme: {
      fonts: { body: "source-sans", heading: "source-serif", code: "ibm-plex-mono" },
      headingWeight: 600,
      bodyLineHeight: 1.8,
      light: { ...DEFAULT_LIGHT, canvas: "#fffdf9", surface: "#ffffff", text: "#1c1a17", muted: "#4d4842", subtle: "#69635b", border: "#e8e2d8", accent: "#9a3412", link: "#8a2e0e" },
      dark: { ...DEFAULT_DARK, canvas: "#13110f", surface: "#1b1916", text: "#f4efe8", muted: "#d2cbc1", subtle: "#aba398", border: "#33302b", accent: "#f0956a", link: "#f6b593" },
      readingWidth: 40,
    },
  },
  midnight: {
    label: "Midnight",
    description: "Dark by default with a teal accent.",
    theme: {
      defaultMode: "dark",
      light: { ...DEFAULT_LIGHT, accent: "#0f766e", link: "#0d6660" },
      dark: { ...DEFAULT_DARK, canvas: "#0b1114", surface: "#121a1e", border: "#24323a", accent: "#2dd4bf", link: "#7ee7d8" },
    },
  },
  contrast: {
    label: "High contrast",
    description: "Maximum legibility: pure black and white, larger text, square corners.",
    theme: {
      textScale: 106,
      radius: "small",
      buttonShape: "square",
      light: { canvas: "#ffffff", surface: "#ffffff", text: "#000000", muted: "#2b2b2b", subtle: "#3d3d3d", border: "#8a8a8a", accent: "#0040c1", link: "#0033a0" },
      dark: { canvas: "#000000", surface: "#0d0d0d", text: "#ffffff", muted: "#e6e6e6", subtle: "#cccccc", border: "#6b6b6b", accent: "#8ab4ff", link: "#a8c7ff" },
    },
  },
};

export const HEADER_PRESETS: Record<SiteConfig["header"]["preset"], { label: string; values: Partial<SiteConfig["header"]> }> = {
  standard: { label: "Standard", values: { width: "contained", height: "regular", navAlign: "start", background: "canvas", logoSize: "md", showSearch: true, showThemeToggle: true } },
  centered: { label: "Centered navigation", values: { width: "contained", height: "tall", navAlign: "center", background: "canvas", logoSize: "md" } },
  minimal: { label: "Minimal", values: { width: "contained", height: "compact", navAlign: "end", background: "canvas", logoSize: "sm", showSearch: false } },
  accent: { label: "Accent bar", values: { width: "full", height: "regular", navAlign: "start", background: "accent", logoSize: "md" } },
};

/** A stable short id for new menu items and sections. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultSection(type: SectionType): Section {
  const d = defaultConfig().homepage.sections;
  const base = { id: newId(type), hidden: false, spacing: "md" as const, background: "none" as const };
  switch (type) {
    case "hero": return { ...(d[0] as Extract<Section, { type: "hero" }>), ...base };
    case "latest": return { ...(d[1] as Extract<Section, { type: "latest" }>), ...base };
    case "topics": return { ...(d[2] as Extract<Section, { type: "topics" }>), ...base };
    case "projects": return { ...(d[3] as Extract<Section, { type: "projects" }>), ...base };
    case "principles": return { ...(d[4] as Extract<Section, { type: "principles" }>), ...base };
    case "author": return { ...(d[5] as Extract<Section, { type: "author" }>), ...base };
    case "featured": return { ...base, type, heading: "Start here", description: "", layout: "grid", paths: [] };
    case "cta": return { ...base, type, heading: "Get new articles as they are published", text: "Follow the RSS feed or search the archive.", primary: { label: "RSS feed", href: "/feed.xml" }, secondary: { label: "Search", href: "/search" } };
    case "text": return { ...base, type, heading: "", body: "Write a short paragraph here." };
  }
}
