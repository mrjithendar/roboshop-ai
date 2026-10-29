"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronDown, DuplicateIcon, EyeOffIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Button, inputClass } from "@/components/ui/form";
import { defaultSection, newId, SECTION_TYPES, type Section, type SectionType, type SiteConfig } from "@/lib/site-config/schema";
import { searchArticlesAction } from "./actions";
import { BannerField, Choice, Grid, LinkField, NumberField, Panel, TextField, Toggle, useEditor } from "./fields";
import { move } from "./panels";
import type { EditorContext as Ctx } from "./AppearanceEditor";

const opts = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));

export function HomepagePanel({ ctx }: { ctx: Ctx }) {
  const { draft, set, issues } = useEditor();
  const sections = (draft as SiteConfig).homepage.sections;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<SectionType>("cta");
  const setSections = (next: Section[]) => set("homepage.sections", next);

  return (
    <>
      <Panel title="Homepage sections" description="Sections appear in this order. Hidden sections keep their settings. Only the approved section types below exist; no code or HTML can be added.">
        {sections.length === 0 && <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-fg-subtle">The homepage is empty. Add a section below.</p>}
        <ol className="space-y-2">
          {sections.map((s, i) => {
            const isOpen = open === s.id;
            const hasIssue = issues.some((x) => x.path.startsWith(`homepage.sections.${i}.`) || x.path === `homepage.sections.${i}`);
            const title = ("heading" in s && s.heading) || SECTION_TYPES[s.type];
            return (
              <li key={s.id} className={`rounded-lg border ${hasIssue ? "border-red-400" : "border-line"} bg-surface`}>
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronDown className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-fg">{title}</span>
                      <span className="block text-xs text-fg-subtle">
                        {SECTION_TYPES[s.type]}
                        {s.hidden ? " · hidden" : ""}
                        {hasIssue ? " · needs attention" : ""}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center">
                    <Act label={`Move ${title} up`} disabled={i === 0} onClick={() => setSections(move(sections, i, i - 1))}>
                      <ArrowUp className="h-4 w-4" />
                    </Act>
                    <Act label={`Move ${title} down`} disabled={i === sections.length - 1} onClick={() => setSections(move(sections, i, i + 1))}>
                      <ArrowDown className="h-4 w-4" />
                    </Act>
                    <Act label={s.hidden ? `Show ${title}` : `Hide ${title}`} pressed={s.hidden} onClick={() => setSections(sections.map((x, j) => (j === i ? { ...x, hidden: !x.hidden } : x)))}>
                      <EyeOffIcon className="h-4 w-4" />
                    </Act>
                    <Act
                      label={`Duplicate ${title}`}
                      disabled={sections.length >= 16}
                      onClick={() => setSections([...sections.slice(0, i + 1), { ...structuredClone(s), id: newId(s.type) }, ...sections.slice(i + 1)])}
                    >
                      <DuplicateIcon className="h-4 w-4" />
                    </Act>
                    <Act label={`Remove ${title}`} onClick={() => window.confirm(`Remove the “${title}” section?`) && setSections(sections.filter((_, j) => j !== i))}>
                      <TrashIcon className="h-4 w-4" />
                    </Act>
                  </div>
                </div>
                {isOpen && (
                  <div className="space-y-5 border-t border-line p-4">
                    <SectionEditor s={s} i={i} ctx={ctx} />
                    <Grid>
                      <Choice path={`homepage.sections.${i}.spacing`} label="Spacing" options={opts({ sm: "Small", md: "Medium", lg: "Large" })} />
                      <Choice path={`homepage.sections.${i}.background`} label="Background" options={opts({ none: "None", muted: "Tinted", accent: "Accent tint" })} />
                    </Grid>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-muted p-3">
          <label className="min-w-0 flex-1 space-y-1 text-sm">
            <span className="block font-medium text-fg">Add a section</span>
            <select value={adding} onChange={(e) => setAdding(e.target.value as SectionType)} className={inputClass}>
              {Object.entries(SECTION_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={sections.length >= 16}
            onClick={() => {
              const s = defaultSection(adding);
              setSections([...sections, s]);
              setOpen(s.id);
            }}
          >
            <PlusIcon className="h-4 w-4" /> Add
          </Button>
        </div>
        <p className="text-sm text-fg-subtle">A newsletter section is not offered: the site has no newsletter service to connect it to. Other pages are edited in Admin → Pages.</p>
      </Panel>
    </>
  );
}

function Act({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken hover:text-fg disabled:opacity-35 aria-pressed:bg-surface-sunken aria-pressed:text-fg"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function SectionEditor({ s, i, ctx }: { s: Section; i: number; ctx: Ctx }) {
  const p = (k: string) => `homepage.sections.${i}.${k}`;
  switch (s.type) {
    case "hero":
      return (
        <>
          <TextField path={p("eyebrow")} label="Eyebrow" max={60} />
          <Grid>
            <TextField path={p("heading")} label="Heading" max={120} />
            <TextField path={p("highlight")} label="Highlighted words (accent colour)" max={60} />
          </Grid>
          <TextField path={p("subtitle")} label="Introduction" max={300} multiline />
          <Grid>
            <TextField path={p("primary.label")} label="Main button text" max={40} />
            <LinkField path={p("primary.href")} label="Main button link" />
            <TextField path={p("secondary.label")} label="Second button text" max={40} />
            <LinkField path={p("secondary.href")} label="Second button link" />
            <Choice path={p("layout")} label="Layout" options={opts({ text: "Text only", split: "Text and image", banner: "Background image" })} />
            <Choice path={p("align")} label="Alignment" options={opts({ start: "Left", center: "Centred" })} />
          </Grid>
          {s.layout !== "text" && <BannerField path={p("image")} label="Introduction" showHeight={s.layout === "banner"} />}
        </>
      );
    case "latest":
      return (
        <>
          <TextField path={p("heading")} label="Heading" max={80} />
          <TextField path={p("description")} label="Description" max={200} />
          <Grid>
            <Choice path={p("layout")} label="Layout" options={opts({ "featured-grid": "Lead story + grid", grid: "Grid", list: "List" })} />
            <NumberField path={p("count")} label="How many" min={1} max={12} />
          </Grid>
          <Collections path={p("collections")} />
          <Toggle path={p("showViewAll")} label="“View all” link" />
        </>
      );
    case "featured":
      return (
        <>
          <TextField path={p("heading")} label="Heading" max={80} />
          <TextField path={p("description")} label="Description" max={200} />
          <Choice path={p("layout")} label="Layout" options={opts({ grid: "Grid", list: "List" })} />
          <ArticlePicker path={p("paths")} selected={s.paths} />
        </>
      );
    case "topics":
      return (
        <>
          <TextField path={p("heading")} label="Heading" max={80} />
          <TextField path={p("description")} label="Description" max={200} />
          <Choice path={p("layout")} label="Layout" options={opts({ cards: "Cards", compact: "Compact list" })} />
          <TopicPicker path={p("categories")} selected={s.categories} ctx={ctx} />
        </>
      );
    case "projects":
      return (
        <>
          <TextField path={p("heading")} label="Heading" max={80} />
          <TextField path={p("description")} label="Description" max={200} />
          <NumberField path={p("count")} label="How many" min={1} max={6} />
        </>
      );
    case "principles":
      return (
        <>
          <TextField path={p("heading")} label="Heading" max={80} />
          <TextField path={p("description")} label="Description" max={200} />
          {s.items.map((_, j) => (
            <fieldset key={j} className="space-y-3 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium text-fg">Item {j + 1}</legend>
              <TextField path={p(`items.${j}.title`)} label="Title" max={60} />
              <TextField path={p(`items.${j}.text`)} label="Text" max={200} />
              <Grid>
                <TextField path={p(`items.${j}.link.label`)} label="Link text" max={40} />
                <LinkField path={p(`items.${j}.link.href`)} label="Link" />
              </Grid>
            </fieldset>
          ))}
        </>
      );
    case "author":
      return (
        <>
          <Grid>
            <TextField path={p("eyebrow")} label="Label" max={40} />
            <Choice path={p("author")} label="Author" options={ctx.authors.map((a) => ({ value: a.slug, label: a.name }))} />
          </Grid>
          <TextField path={p("text")} label="Short bio" max={400} multiline />
          <Toggle path={p("showLinks")} label="Profile links" hint="The verified links from the author's profile." />
        </>
      );
    case "cta":
      return (
        <>
          <TextField path={p("heading")} label="Heading" max={80} />
          <TextField path={p("text")} label="Text" max={300} multiline />
          <Grid>
            <TextField path={p("primary.label")} label="Main button text" max={40} />
            <LinkField path={p("primary.href")} label="Main button link" />
            <TextField path={p("secondary.label")} label="Second button text" max={40} />
            <LinkField path={p("secondary.href")} label="Second button link" />
          </Grid>
        </>
      );
    case "text":
      return (
        <>
          <TextField path={p("heading")} label="Heading (optional)" max={80} />
          <TextField path={p("body")} label="Text" max={2000} multiline rows={6} hint="Plain text. A blank line starts a new paragraph." />
        </>
      );
  }
}

function Collections({ path }: { path: string }) {
  const { draft, set } = useEditor();
  const value = (path.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], draft) ?? []) as string[];
  const all = [
    ["blog", "Articles"],
    ["news", "News"],
    ["projects", "Projects"],
  ] as const;
  return (
    <fieldset>
      <legend className="text-sm font-medium text-fg">Include</legend>
      <div className="mt-2 flex flex-wrap gap-4">
        {all.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={value.includes(k)}
              disabled={value.length === 1 && value.includes(k)}
              onChange={(e) => set(path, e.target.checked ? all.map(([x]) => x).filter((x) => x === k || value.includes(x)) : value.filter((x) => x !== k))}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TopicPicker({ path, selected, ctx }: { path: string; selected: string[]; ctx: Ctx }) {
  const { set } = useEditor();
  return (
    <fieldset>
      <legend className="text-sm font-medium text-fg">Topics (none selected = all, in their usual order)</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {ctx.categories.map((c) => (
          <label key={c.slug} className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={selected.includes(c.slug)} onChange={(e) => set(path, e.target.checked ? [...selected, c.slug] : selected.filter((x) => x !== c.slug))} />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Search published articles and pick up to six, in order. */
function ArticlePicker({ path, selected }: { path: string; selected: string[] }) {
  const { set } = useEditor();
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ path: string; title: string; collection: string }[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = window.setTimeout(() => {
      start(async () => {
        const r = await searchArticlesAction(q);
        if (r.ok) {
          setResults(r.items);
          setTitles((prev) => ({ ...prev, ...Object.fromEntries(r.items.map((x) => [x.path, x.title])) }));
          setError(null);
        } else setError(r.error);
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-fg">Articles ({selected.length}/6)</p>
      {selected.length === 0 && <p className="text-sm text-fg-subtle">None picked yet. The section is not shown until it has at least one published article.</p>}
      <ol className="space-y-1">
        {selected.map((sp, j) => (
          <li key={sp} className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-fg">{titles[sp] ?? sp}</span>
            <Act label="Move up" disabled={j === 0} onClick={() => set(path, move(selected, j, j - 1))}>
              <ArrowUp className="h-4 w-4" />
            </Act>
            <Act label="Remove" onClick={() => set(path, selected.filter((x) => x !== sp))}>
              <TrashIcon className="h-4 w-4" />
            </Act>
          </li>
        ))}
      </ol>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        Find published articles
      </label>
      <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" className={inputClass} aria-busy={pending || undefined} />
      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <ul className="max-h-60 overflow-y-auto rounded-md border border-line">
        {results.length === 0 && <li className="px-3 py-2 text-sm text-fg-subtle">{pending ? "Searching…" : "No published articles match."}</li>}
        {results.map((r) => (
          <li key={r.path} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm last:border-0">
            <span className="min-w-0 flex-1 truncate text-fg">
              {r.title} <span className="text-fg-subtle">· {r.collection}</span>
            </span>
            <Button type="button" size="sm" variant="ghost" disabled={selected.includes(r.path) || selected.length >= 6} onClick={() => set(path, [...selected, r.path])}>
              Add
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
