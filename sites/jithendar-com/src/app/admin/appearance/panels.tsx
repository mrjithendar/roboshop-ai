"use client";

import Link from "next/link";
import { CheckIcon, AlertIcon } from "@/components/icons";
import { Alert, Button } from "@/components/ui/form";
import { checkCustomCss } from "@/lib/site-config/css";
import { BODY_FONTS, CODE_FONTS, DATE_FORMATS, defaultConfig, HEADER_PRESETS, THEME_PRESETS, TIMEZONES, type SiteConfig } from "@/lib/site-config/schema";
import { BannerField, Choice, ColorField, getIn, Grid, ImageField, LinkField, NumberField, Panel, TextField, Toggle, useEditor, useField } from "./fields";
import type { EditorContext as Ctx } from "./AppearanceEditor";

const opts = <T extends string | number>(o: Record<string, string> | [T, string][]) =>
  (Array.isArray(o) ? o : Object.entries(o)).map(([value, label]) => ({ value: value as T, label }));

// --- General ---------------------------------------------------------------------------------------------------

export function GeneralPanel() {
  const maintenance = useField<boolean>("general.maintenance.enabled");
  return (
    <>
      <Panel title="Identity" description="Used in page titles, the header, feeds, structured data and share cards.">
        <Grid>
          <TextField path="general.siteName" label="Site name" max={60} />
          <TextField path="general.publicationName" label="Publication name" max={60} hint="Used in news sitemaps and structured data." />
        </Grid>
        <TextField path="general.tagline" label="Tagline" max={80} hint="Shown on the generated share card." />
        <TextField path="general.description" label="Description" max={200} multiline rows={2} hint="The default meta description and footer text (50–200 characters)." />
      </Panel>
      <Panel title="Dates" description="Applies to every date on the site once published.">
        <Grid>
          <Choice path="general.timezone" label="Editorial time zone" options={TIMEZONES.map((z) => ({ value: z, label: z.replace("_", " ") }))} />
          <Choice path="general.dateFormat" label="Date format" options={opts(DATE_FORMATS)} />
        </Grid>
      </Panel>
      <Panel title="Contact and social profiles" description="Public details. Leave a field empty to hide it.">
        <Grid>
          <TextField path="general.contact.email" label="Public contact email" type="email" max={200} />
          <TextField path="general.contact.location" label="Location" max={80} placeholder="Hyderabad, India" />
          <TextField path="general.social.github" label="GitHub" placeholder="https://github.com/…" />
          <TextField path="general.social.linkedin" label="LinkedIn" placeholder="https://www.linkedin.com/in/…" />
          <TextField path="general.social.x" label="X" placeholder="https://x.com/…" />
          <TextField path="general.social.youtube" label="YouTube" placeholder="https://www.youtube.com/@…" />
          <TextField path="general.social.mastodon" label="Mastodon" placeholder="https://mastodon.social/@…" />
        </Grid>
      </Panel>
      <Panel title="Features">
        <Toggle path="general.features.comments" label="Comments" hint="Signed-in readers can comment; comments are moderated." />
        <Toggle path="general.features.registration" label="Reader sign-up" hint="New accounts by email or Google/GitHub. Existing users can always sign in." />
        <Toggle path="general.features.contactForm" label="Contact form" hint="Shown on /contact; messages arrive in Admin → Messages." />
      </Panel>
      <Panel title="Maintenance mode" description="Public pages answer 503 (Service Unavailable) with Retry-After, so search engines keep your pages indexed. Admins and authors keep browsing; sign-in, admin and account pages stay available. Applies on every server within 10 seconds of publishing.">
        {maintenance.value && <Alert tone="info">Maintenance mode is on in this draft. Publishing will take the public site offline for readers.</Alert>}
        <Toggle path="general.maintenance.enabled" label="Enable maintenance mode" />
        <TextField path="general.maintenance.message" label="Message for readers" max={300} multiline rows={2} />
        <NumberField path="general.maintenance.retryAfterMinutes" label="Ask crawlers to retry after" min={5} max={1440} step={5} unit=" min" />
      </Panel>
    </>
  );
}

// --- Branding ----------------------------------------------------------------------------------------------------

export function BrandingPanel() {
  return (
    <>
      <Panel title="Logo" description="Without a logo image the site shows its monogram and name. SVG files shipped under /images and uploads both work.">
        <Toggle path="branding.showWordmark" label="Show the site name next to the logo" />
        <ImageField path="branding.logoLight" label="Logo (light theme)" focal={false} fit={false} />
        <ImageField path="branding.logoDark" label="Logo (dark theme, optional)" focal={false} fit={false} />
        <ImageField path="branding.logoMobile" label="Logo on phones (optional)" focal={false} fit={false} hint="A compact mark for narrow screens." />
      </Panel>
      <Panel title="Icons" description="Square PNG images: favicon at least 48 × 48 px, Apple touch icon 180 × 180 px.">
        <ImageField path="branding.favicon" label="Favicon" focal={false} fit={false} />
        <ImageField path="branding.appleIcon" label="Apple touch icon" focal={false} fit={false} />
      </Panel>
      <Panel title="Default share image" description="Used when a page has no image of its own (1200 × 630 px PNG or JPEG). Without one, a card with the site name and tagline is generated.">
        <ImageField path="branding.socialImage" label="Share image" fit={false} />
      </Panel>
    </>
  );
}

// --- Header ----------------------------------------------------------------------------------------------------------

export function HeaderPanel({ ctx }: { ctx: Ctx }) {
  const { draft, set } = useEditor();
  const background = getIn(draft, "header.background");
  const applyPreset = (key: keyof typeof HEADER_PRESETS) => {
    let next = draft as SiteConfig;
    next = { ...next, header: { ...next.header, ...HEADER_PRESETS[key].values, preset: key } };
    set("header", next.header);
  };
  return (
    <>
      <Panel title="Presets" description="Start from a coherent combination, then adjust below.">
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(HEADER_PRESETS) as (keyof typeof HEADER_PRESETS)[]).map((k) => (
            <Button key={k} type="button" variant={getIn(draft, "header.preset") === k ? "primary" : "secondary"} onClick={() => applyPreset(k)} aria-pressed={getIn(draft, "header.preset") === k}>
              {HEADER_PRESETS[k].label}
            </Button>
          ))}
        </div>
      </Panel>
      <Panel title="Layout">
        <Grid>
          <Choice path="header.width" label="Width" options={opts({ contained: "Page width", full: "Full width" })} />
          <Choice path="header.height" label="Height" options={opts({ compact: "Compact", regular: "Regular", tall: "Tall" })} />
          <Choice path="header.navAlign" label="Navigation position" options={opts({ start: "After logo", center: "Centred", end: "Right" })} />
          <Choice path="header.logoSize" label="Logo size" options={opts({ sm: "Small", md: "Medium", lg: "Large" })} />
        </Grid>
        <Toggle path="header.sticky" label="Keep the header visible while scrolling" />
      </Panel>
      <Panel title="Background" description="Accent and image backgrounds switch the header text to a contrasting colour automatically.">
        <Choice path="header.background" label="Background" options={opts({ canvas: "Page", muted: "Tinted", accent: "Accent", image: "Image" })} />
        {background === "image" && <BannerField path="header.image" label="Header" showHeight={false} />}
      </Panel>
      <Panel title="Controls" description="The mobile menu and keyboard navigation always remain available.">
        <Toggle path="header.showSearch" label="Search" />
        <Toggle path="header.showThemeToggle" label="Light/dark switch" hint="Also controls the theme selector in the footer and mobile menu." />
        <Toggle path="header.showAccount" label="Account avatar and menu" hint="When hidden, readers can still sign in at /login; consider a menu link to it." />
        <Toggle path="header.showSocial" label="Social profile icons" hint="On wide screens only; profiles come from General." />
        <Toggle path="header.cta.show" label="Call-to-action button" />
        {(getIn(draft, "header.cta.show") as boolean) && (
          <Grid>
            <TextField path="header.cta.label" label="Button text" max={24} />
            <LinkField path="header.cta.href" label="Button link" />
          </Grid>
        )}
      </Panel>
      <Panel title="Announcement bar" description="A one-line notice above the header on every page.">
        <Toggle path="header.announcement.enabled" label="Show the announcement" />
        <TextField path="header.announcement.text" label="Text" max={200} />
        <Grid>
          <LinkField path="header.announcement.href" label="Link (optional)" />
          <Choice path="header.announcement.tone" label="Style" options={opts({ neutral: "Neutral", accent: "Accent", warning: "Warning" })} />
        </Grid>
        <Toggle path="header.announcement.dismissible" label="Readers can dismiss it" hint="Remembered in their browser until the text changes." />
      </Panel>
      <p className="text-sm text-fg-subtle">
        Menu items are edited under Navigation. {ctx.pages.length} site pages are available to link.
      </p>
    </>
  );
}

// --- Footer ------------------------------------------------------------------------------------------------------------

export function FooterPanel() {
  const { draft, set } = useEditor();
  const c = draft as SiteConfig;
  const columns = c.footer.columns;
  const setColumns = (next: SiteConfig["footer"]["columns"]) => set("footer.columns", next);
  return (
    <>
      <Panel title="Layout">
        <Grid>
          <Choice path="footer.preset" label="Preset" options={opts({ columns: "Columns", simple: "Simple", centered: "Centred" })} />
          <Choice path="footer.align" label="Alignment" options={opts({ start: "Left", center: "Centre" })} />
          <Choice path="footer.spacing" label="Spacing" options={opts({ compact: "Compact", regular: "Regular", spacious: "Spacious" })} />
          <Choice path="footer.background" label="Background" options={opts({ muted: "Tinted", canvas: "Page", inverted: "Inverted", image: "Image" })} />
        </Grid>
        {c.footer.background === "image" && <BannerField path="footer.image" label="Footer" showHeight={false} />}
      </Panel>
      <Panel
        title="Columns"
        description="Up to four link columns, each from a menu (edit menus under Navigation) or the list of topics. Hidden in the Simple preset."
        actions={
          columns.length < 4 && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setColumns([...columns, { id: `col-${Date.now().toString(36)}`, title: "Links", source: "menu", menuId: c.navigation.menus[0]?.id ?? "" }])}>
              Add column
            </Button>
          )
        }
      >
        {columns.length === 0 && <p className="text-sm text-fg-subtle">No columns. The footer shows the site details and legal links only.</p>}
        <ol className="space-y-3">
          {columns.map((col, i) => (
            <li key={col.id} className="rounded-lg border border-line p-4">
              <Grid>
                <TextField path={`footer.columns.${i}.title`} label="Heading" max={40} />
                <Choice path={`footer.columns.${i}.source`} label="Links from" options={opts({ menu: "A menu", topics: "Topics" })} />
                {col.source === "menu" && <Choice path={`footer.columns.${i}.menuId`} label="Menu" options={c.navigation.menus.map((m) => ({ value: m.id, label: m.name }))} />}
              </Grid>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => setColumns(move(columns, i, i - 1))}>
                  Move left
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={i === columns.length - 1} onClick={() => setColumns(move(columns, i, i + 1))}>
                  Move right
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setColumns(columns.filter((_, j) => j !== i))}>
                  Remove<span className="sr-only"> column {col.title}</span>
                </Button>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Content">
        <Toggle path="footer.showLogo" label="Logo and site name" />
        <TextField path="footer.description" label="Description" max={300} multiline rows={2} hint="Empty uses the site description from General." />
        <Toggle path="footer.showSocial" label="Social profile links" />
        <Toggle path="footer.showRss" label="RSS feed link" />
        <Toggle path="footer.showContact" label="Contact email and location" hint="From General → Contact." />
        <TextField path="footer.copyright" label="Copyright line" max={160} hint="{year} becomes the current year and {site} the site name." />
        <p className="text-sm text-fg-subtle">Policy links and “Privacy choices” (cookie consent) are always shown: they are required.</p>
      </Panel>
    </>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

// --- Typography & colours ---------------------------------------------------------------------------------------

const PALETTE_FIELDS: { key: keyof SiteConfig["theme"]["light"]; label: string; check?: boolean }[] = [
  { key: "canvas", label: "Page background" },
  { key: "surface", label: "Cards" },
  { key: "text", label: "Text", check: true },
  { key: "muted", label: "Secondary text", check: true },
  { key: "subtle", label: "Meta text (dates, captions)", check: true },
  { key: "border", label: "Borders" },
  { key: "accent", label: "Accent (buttons, highlights)" },
  { key: "link", label: "Links", check: true },
];

function Palette({ mode }: { mode: "light" | "dark" }) {
  const { draft } = useEditor();
  const canvas = getIn(draft, `theme.${mode}.canvas`) as string;
  return (
    <Grid>
      {PALETTE_FIELDS.map((f) => (
        <ColorField key={f.key} path={`theme.${mode}.${f.key}`} label={f.label} against={f.check ? canvas : undefined} />
      ))}
    </Grid>
  );
}

export function ThemePanel() {
  const { draft, set } = useEditor();
  const applyPreset = (key: string) => {
    const preset = THEME_PRESETS[key]!;
    set("theme", { ...(draft as SiteConfig).theme, ...structuredClone(preset.theme) });
  };
  const fontOptions = opts(BODY_FONTS);
  return (
    <>
      <Panel
        title="Presets"
        description="Professionally balanced starting points. Applying one replaces typography and colours (not your header, footer or content)."
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={() => set("theme", defaultConfig().theme)}>
            Restore default theme
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(THEME_PRESETS).map(([key, p]) => (
            <button key={key} type="button" onClick={() => applyPreset(key)} className="rounded-lg border border-line p-4 text-left transition-colors hover:border-line-strong hover:bg-surface-muted">
              <span className="flex gap-1.5" aria-hidden="true">
                {[p.theme.light?.canvas, p.theme.light?.text, p.theme.light?.accent, p.theme.dark?.canvas, p.theme.dark?.accent].map((c, i) => (
                  <span key={i} className="h-5 w-5 rounded-full border border-line" style={{ background: c ?? "transparent" }} />
                ))}
              </span>
              <span className="mt-3 block text-sm font-semibold text-fg">{p.label}</span>
              <span className="mt-0.5 block text-sm text-fg-muted">{p.description}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Typography" description="Fonts are self-hosted; only the faces you use are downloaded by readers.">
        <Grid>
          <Choice path="theme.fonts.body" label="Body font" options={fontOptions} />
          <Choice path="theme.fonts.heading" label="Heading font" options={fontOptions} />
          <Choice path="theme.fonts.code" label="Code font" options={opts(CODE_FONTS)} />
          <Choice path="theme.headingWeight" label="Heading weight" options={opts<number>([[600, "Semibold"], [700, "Bold"], [800, "Extra bold"]])} />
          <Choice path="theme.textScale" label="Text size" options={opts<number>([[100, "Default"], [106, "Larger"], [112, "Largest"]])} hint="Scales all text; form inputs never go below 16 px." />
          <NumberField path="theme.bodyLineHeight" label="Article line height" min={1.5} max={1.9} step={0.05} />
        </Grid>
      </Panel>
      <Panel title="Light theme colours" description="Text colours need 4.5:1 contrast on the page background to publish.">
        <Palette mode="light" />
      </Panel>
      <Panel title="Dark theme colours">
        <Palette mode="dark" />
      </Panel>
      <Panel title="Layout and shape">
        <Grid>
          <NumberField path="theme.contentWidth" label="Page width" min={64} max={88} unit=" rem" />
          <NumberField path="theme.readingWidth" label="Article reading width" min={36} max={50} unit=" rem" hint="About 70 characters per line at 43 rem." />
          <Choice path="theme.density" label="Spacing between sections" options={opts({ compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" })} />
          <Choice path="theme.radius" label="Corner radius" options={opts({ none: "None", small: "Small", medium: "Medium", large: "Large" })} />
          <Choice path="theme.buttonShape" label="Buttons and inputs" options={opts({ rounded: "Rounded", pill: "Pill", square: "Square" })} />
          <Choice path="theme.defaultMode" label="Default theme for new visitors" options={opts({ system: "Follow device", light: "Light", dark: "Dark" })} hint="Readers can still switch if the switch is shown." />
        </Grid>
      </Panel>
    </>
  );
}

// --- Blog & articles -------------------------------------------------------------------------------------------

export function BlogPanel() {
  return (
    <>
      <Panel title="Listings" description="Articles, News, Projects, topic, tag and author pages, and article lists on the homepage.">
        <Grid>
          <Choice path="blog.listing.layout" label="Layout" options={opts({ grid: "Grid", list: "List" })} />
          <Choice path="blog.listing.columns" label="Cards per row (wide screens)" options={opts<number>([[2, "2"], [3, "3"]])} />
          <NumberField path="blog.listing.pageSize" label="Articles per page" min={6} max={24} />
          <NumberField path="blog.listing.excerptLines" label="Excerpt lines (0 hides it)" min={0} max={4} />
          <Choice path="blog.listing.coverAspect" label="Cover image shape" options={opts({ "16/9": "16:9", "3/2": "3:2", "4/3": "4:3", "1/1": "Square", none: "No cover" })} />
        </Grid>
        <Toggle path="blog.listing.showCategory" label="Topic" />
        <Toggle path="blog.listing.showType" label="Article type (News, Tutorial…)" />
        <Toggle path="blog.listing.showDate" label="Date" />
        <Toggle path="blog.listing.showReadingTime" label="Reading time" />
        <p className="text-sm text-fg-subtle">Sponsored and preview labels always show; they are disclosures.</p>
      </Panel>
      <Panel title="Article pages" description="Hidden elements stay in the page's structured data, so search results keep author and dates.">
        <Grid>
          <Choice path="blog.article.width" label="Reading width" options={opts({ narrow: "Narrow", default: "Default", wide: "Wide" })} />
          <Choice path="blog.article.bodySize" label="Body text size (desktop)" options={opts<number>([[16, "16 px"], [17, "17 px"], [18, "18 px"], [19, "19 px"]])} />
        </Grid>
        <Toggle path="blog.article.showBreadcrumbs" label="Breadcrumbs" />
        <Toggle path="blog.article.showAuthor" label="Author in the byline" />
        <Toggle path="blog.article.showUpdated" label="“Updated” date" />
        <Toggle path="blog.article.showReadingTime" label="Reading time" />
        <Toggle path="blog.article.showCover" label="Cover image" />
        <Toggle path="blog.article.showAuthorCard" label="Author card after the article" />
      </Panel>
      <Panel title="Table of contents">
        <Toggle path="blog.article.toc.enabled" label="Show a table of contents" />
        <Grid>
          <NumberField path="blog.article.toc.minHeadings" label="Only for articles with at least" min={2} max={8} unit=" headings" />
          <Choice path="blog.article.sidebar" label="On wide screens" options={opts({ toc: "In the right margin", none: "Above the article" })} />
        </Grid>
      </Panel>
      <Panel title="Related articles and sharing">
        <Toggle path="blog.article.related.enabled" label="Related reading" />
        <NumberField path="blog.article.related.count" label="How many" min={1} max={6} />
        <Toggle path="blog.article.share.enabled" label="Share links" hint="Plain links to each network's share page: no third-party scripts." />
        <ShareNetworks />
      </Panel>
    </>
  );
}

function ShareNetworks() {
  const f = useField<("x" | "linkedin" | "email" | "copy")[]>("blog.article.share.networks");
  const all = [
    ["x", "X"],
    ["linkedin", "LinkedIn"],
    ["email", "Email"],
    ["copy", "Copy link"],
  ] as const;
  return (
    <fieldset>
      <legend className="text-sm font-medium text-fg">Networks</legend>
      <div className="mt-2 flex flex-wrap gap-4">
        {all.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={f.value.includes(key)} onChange={(e) => f.set(e.target.checked ? all.map(([k]) => k).filter((k) => k === key || f.value.includes(k)) : f.value.filter((k) => k !== key))} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// --- Media -------------------------------------------------------------------------------------------------------

export function MediaPanel({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <Panel title="Images in articles">
        <Grid>
          <Choice path="media.imageRadius" label="Image corners" options={opts({ none: "Square", small: "Small", medium: "Medium" })} />
          <Choice path="media.captionAlign" label="Captions" options={opts({ center: "Centred", start: "Left" })} />
          <Choice path="media.galleryColumns" label="Gallery columns" options={opts<number>([[2, "2"], [3, "3"], [4, "4"]])} />
        </Grid>
      </Panel>
      <Panel title="Library and storage">
        <StatusRow ok={ctx.status.storage} label="Cloudflare R2 storage" detail={ctx.status.storage ? "Uploads are enabled." : "Uploads are disabled until storage is configured."} />
        <p className="text-sm text-fg-muted">
          Upload, search and edit alt text in the{" "}
          <Link href="/admin/media" className="link">
            Media library
          </Link>
          ; storage credentials are managed in{" "}
          <Link href="/admin/storage" className="link">
            Storage &amp; email
          </Link>
          . Images chosen here are served in responsive AVIF/WebP sizes and count as “in use” in the library.
        </p>
      </Panel>
    </>
  );
}

// --- SEO & integrations -----------------------------------------------------------------------------------------

export function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-surface-sunken text-fg-subtle"}`}>
        {ok ? <CheckIcon className="h-3 w-3" /> : <AlertIcon className="h-3 w-3" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="text-sm text-fg-muted">{detail}</p>
      </div>
    </div>
  );
}

export function SeoPanel({ ctx }: { ctx: Ctx }) {
  const { draft } = useEditor();
  const c = draft as SiteConfig;
  const s = ctx.status;
  return (
    <>
      <Panel title="Titles and descriptions">
        <Grid>
          <TextField path="seo.homeTitle" label="Homepage title" max={70} />
          <Choice path="seo.titleSeparator" label="Title separator" options={opts({ "|": "|", "·": "·", "—": "—", "-": "-" })} />
        </Grid>
        <div className="rounded-lg border border-line p-4" aria-label="Search result preview">
          <p className="text-xs text-fg-subtle">Search result preview (article)</p>
          <p className="mt-1 truncate text-lg text-accent-text">
            Deploying a Next.js site to Kubernetes {c.seo?.titleSeparator} {c.general?.siteName}
          </p>
          <p className="line-clamp-2 text-sm text-fg-muted">{c.general?.description}</p>
        </div>
        <p className="text-sm text-fg-subtle">The default description is set in General; the default share image in Branding.</p>
      </Panel>
      <Panel title="Integrations (status)" description="These are configured outside the database, in Kubernetes Secrets and the public ConfigMap, so no key is stored or shown here.">
        <StatusRow ok={s.googleVerification > 0} label="Google Search Console verification" detail={s.googleVerification ? `${s.googleVerification} token(s) configured.` : "Not configured (DNS verification needs nothing here)."} />
        <StatusRow ok={s.bingVerification > 0} label="Bing Webmaster Tools verification" detail={s.bingVerification ? `${s.bingVerification} token(s) configured.` : "Not configured."} />
        <StatusRow ok={s.ga4} label="Google Analytics 4" detail={s.ga4 ? (s.ga4Active ? "Active in production, with Consent Mode." : "Configured; loads in production only.") : "Not configured."} />
        <StatusRow ok={!!s.adsense} label="Google AdSense" detail={s.adsense ? `${s.adsense.slots} ad slot(s)${s.adsense.test ? ", test mode" : ""}.` : "Not configured."} />
        <StatusRow ok={s.adsTxt} label="ads.txt" detail={s.adsTxt ? "Served at /ads.txt." : "Not configured (/ads.txt returns 404)."} />
        <StatusRow ok label="Consent default" detail={s.consentDefault === "strict" ? "Denied everywhere until the visitor consents." : "Denied in the EEA, UK and Switzerland until consent."} />
        <StatusRow ok={s.indexNow} label="IndexNow" detail={s.indexNow ? "Configured; submissions in production." : "Not configured."} />
        <p className="text-sm text-fg-muted">
          To change these, run <code className="rounded bg-surface-sunken px-1 font-mono text-xs">scripts/set-public-config.sh</code> (see docs/SEO_ANALYTICS_ADS.md). Scripts and tracking codes cannot be pasted here by design.
        </p>
      </Panel>
      <Panel title="Other services (status)">
        <StatusRow ok={s.turnstile} label="Cloudflare Turnstile" detail={s.turnstile ? "Configured (sign-in, contact and comments)." : "Not configured: email sign-in and forms are unavailable."} />
        <StatusRow ok={s.mail} label="Email" detail={s.mail ? "Configured." : "Not configured: password resets are not sent."} />
        <StatusRow ok={s.oauth.length > 0} label="Social sign-in" detail={s.oauth.length ? `Enabled: ${s.oauth.join(", ")}.` : "No provider configured (docs/AUTH.md)."} />
        <StatusRow ok={s.gemini} label="Gemini image generation" detail={s.gemini ? "Configured." : "Not configured."} />
      </Panel>
    </>
  );
}

// --- Advanced ---------------------------------------------------------------------------------------------------

export function AdvancedPanel() {
  const css = useField<string>("advanced.customCss.css");
  const enabled = useField<boolean>("advanced.customCss.enabled");
  const problems = enabled.value ? checkCustomCss(css.value ?? "") : [];
  return (
    <Panel
      title="Custom CSS"
      description="A restricted escape hatch for small styling fixes. Styling rules only: no @import, url(), scripts, escapes or fixed overlays. Preview before publishing; prefer the controls in the other sections."
    >
      <Toggle path="advanced.customCss.enabled" label="Apply custom CSS" />
      <TextField path="advanced.customCss.css" label="CSS" multiline rows={10} mono max={10000} placeholder=".prose h2 { letter-spacing: -0.01em; }" />
      {enabled.value &&
        (problems.length === 0 ? (
          <Alert tone="success">No problems found.</Alert>
        ) : (
          <Alert>
            <ul className="list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        ))}
    </Panel>
  );
}
