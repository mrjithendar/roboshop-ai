"use client";

import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, GripIcon, TrashIcon } from "@/components/icons";
import { Alert, Button, inputClass } from "@/components/ui/form";
import { newId, safeHref, type MenuItem, type SiteConfig } from "@/lib/site-config/schema";
import { Choice, Panel, useEditor } from "./fields";
import type { EditorContext as Ctx } from "./AppearanceEditor";

type Menu = SiteConfig["navigation"]["menus"][number];

/** Flatten the tree to rows with depth, apply an edit, rebuild. One level of nesting at most. */
type Row = { item: MenuItem; depth: 0 | 1 };
const flatten = (items: MenuItem[]): Row[] => items.flatMap((i) => [{ item: { ...i, children: [] }, depth: 0 as const }, ...i.children.map((c) => ({ item: { ...c, children: [] }, depth: 1 as const }))]);
function build(rows: Row[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const r of rows) {
    if (r.depth === 1 && out.length) out[out.length - 1]!.children.push({ id: r.item.id, label: r.item.label, href: r.item.href, newTab: r.item.newTab, children: [] });
    else out.push({ ...r.item, children: [] });
  }
  return out;
}

export function NavigationPanel({ ctx }: { ctx: Ctx }) {
  const { draft, set } = useEditor();
  const nav = (draft as SiteConfig).navigation;
  const footerUses = new Set((draft as SiteConfig).footer.columns.filter((c) => c.source === "menu").map((c) => c.menuId));
  const [selected, setSelected] = useState(nav.menus[0]?.id ?? "");
  const index = Math.max(0, nav.menus.findIndex((m) => m.id === selected));
  const menu = nav.menus[index];

  const setMenus = (menus: Menu[]) => set("navigation.menus", menus);
  const setMenu = (patch: Partial<Menu>) => setMenus(nav.menus.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  const setRows = (rows: Row[]) => setMenu({ items: build(rows) });

  return (
    <>
      <Panel title="Menus" description="Create menus, then choose which one the header shows. Footer columns pick menus in the Footer section.">
        <Choice path="navigation.headerMenu" label="Header menu" options={nav.menus.map((m) => ({ value: m.id, label: m.name }))} />
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Menus">
          {nav.menus.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === menu?.id}
              onClick={() => setSelected(m.id)}
              className={`min-h-9 rounded-lg border px-3 text-sm font-medium ${m.id === menu?.id ? "border-accent bg-accent-soft text-accent-text" : "border-line text-fg-muted hover:text-fg"}`}
            >
              {m.name}
            </button>
          ))}
          {nav.menus.length < 8 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const id = newId("menu");
                setMenus([...nav.menus, { id, name: "New menu", items: [{ id: newId("item"), label: "Home", href: "/", newTab: false, children: [] }] }]);
                setSelected(id);
              }}
            >
              New menu
            </Button>
          )}
        </div>
      </Panel>

      {menu && (
        <Panel
          title={`Edit “${menu.name}”`}
          description="Reorder with the arrow buttons (keyboard) or by dragging. Indent makes an item a sub-item of the one above (one level)."
          actions={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={menu.id === nav.headerMenu || footerUses.has(menu.id) || nav.menus.length === 1}
              title={menu.id === nav.headerMenu ? "The header menu cannot be deleted" : footerUses.has(menu.id) ? "Used by a footer column" : undefined}
              onClick={() => {
                setMenus(nav.menus.filter((m) => m.id !== menu.id));
                setSelected(nav.menus[0]!.id === menu.id ? (nav.menus[1]?.id ?? "") : nav.menus[0]!.id);
              }}
            >
              <TrashIcon className="h-4 w-4" /> Delete menu
            </Button>
          }
        >
          <label className="block max-w-sm space-y-1.5 text-sm">
            <span className="block font-medium text-fg">Menu name (admin only)</span>
            <input value={menu.name} maxLength={40} onChange={(e) => setMenu({ name: e.target.value })} className={inputClass} />
          </label>
          {menu.id === nav.headerMenu && menu.items.length > 8 && <Alert>The header shows at most 8 top-level items.</Alert>}
          <Destinations ctx={ctx} />
          <ItemList rows={flatten(menu.items)} onChange={setRows} />
          <AddItem ctx={ctx} disabled={menu.items.length >= 12} onAdd={(item) => setMenu({ items: [...menu.items, item] })} />
          <MenuPreview items={menu.items} />
        </Panel>
      )}
    </>
  );
}

function ItemList({ rows, onChange }: { rows: Row[]; onChange: (rows: Row[]) => void }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const update = (i: number, patch: Partial<MenuItem>) => onChange(rows.map((r, j) => (j === i ? { ...r, item: { ...r.item, ...patch } } : r)));
  /** Move a row with its children (top-level) or alone (sub-item). */
  const block = (i: number) => {
    let end = i + 1;
    if (rows[i]!.depth === 0) while (end < rows.length && rows[end]!.depth === 1) end++;
    return [i, end] as const;
  };
  const moveBlock = (i: number, dir: -1 | 1) => {
    const [start, end] = block(i);
    const chunk = rows.slice(start, end);
    const rest = [...rows.slice(0, start), ...rows.slice(end)];
    let target: number;
    if (dir === -1) {
      if (start === 0) return;
      target = start - 1;
      if (rows[i]!.depth === 0) while (target > 0 && rest[target]!.depth === 1) target--;
    } else {
      if (end >= rows.length) return;
      const [, nextEnd] = block(end);
      target = start + (rows[i]!.depth === 0 ? nextEnd - end : 1);
    }
    onChange([...rest.slice(0, target), ...chunk, ...rest.slice(target)]);
  };
  const childCount = (i: number) => block(i)[1] - i - 1;
  const canIndent = (i: number) => i > 0 && rows[i]!.depth === 0 && childCount(i) === 0 && countChildrenOfParentAbove(rows, i) < 8;
  const canOutdent = (i: number) => rows[i]!.depth === 1;
  const remove = (i: number) => {
    const [start, end] = block(i);
    // Removing a parent keeps its children as top-level items.
    onChange([...rows.slice(0, start), ...rows.slice(start + 1, end).map((r) => ({ ...r, depth: 0 as const })), ...rows.slice(end)]);
  };

  if (rows.length === 0) return <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-fg-subtle">This menu is empty. Add an item below.</p>;
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => {
        const error = safeHref(r.item.href) ? null : "Use a site path like /blog or an https:// link.";
        return (
          <li
            key={r.item.id}
            draggable={r.depth === 0}
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => r.depth === 0 && dragFrom !== null && e.preventDefault()}
            onDrop={() => {
              if (dragFrom === null || dragFrom === i) return;
              const [s, e] = block(dragFrom);
              const chunk = rows.slice(s, e);
              const rest = [...rows.slice(0, s), ...rows.slice(e)];
              const at = rest.findIndex((x) => x.item.id === r.item.id);
              onChange([...rest.slice(0, at), ...chunk, ...rest.slice(at)]);
              setDragFrom(null);
            }}
            className={`rounded-lg border border-line bg-surface p-3 ${r.depth === 1 ? "ml-6 sm:ml-10" : ""}`}
          >
            <div className="flex flex-wrap items-start gap-2">
              {r.depth === 0 && <GripIcon className="mt-3 h-4 w-4 shrink-0 cursor-grab text-fg-subtle" aria-hidden="true" />}
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <input aria-label="Label" value={r.item.label} maxLength={40} onChange={(e) => update(i, { label: e.target.value })} className={inputClass} />
                <div>
                  <input
                    aria-label="Link"
                    value={r.item.href}
                    maxLength={300}
                    onChange={(e) => update(i, { href: e.target.value.trim() })}
                    list="nav-destinations"
                    aria-invalid={!!error || undefined}
                    className={inputClass}
                  />
                  {error && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>}
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <label className="mr-2 flex items-center gap-2 text-sm text-fg-muted">
                <input type="checkbox" checked={r.item.newTab} onChange={(e) => update(i, { newTab: e.target.checked })} />
                New tab
              </label>
              <IconAction label={`Move ${r.item.label} up`} onClick={() => moveBlock(i, -1)} disabled={i === 0}>
                <ArrowUp className="h-4 w-4" />
              </IconAction>
              <IconAction label={`Move ${r.item.label} down`} onClick={() => moveBlock(i, 1)} disabled={block(i)[1] >= rows.length}>
                <ArrowDown className="h-4 w-4" />
              </IconAction>
              <IconAction label={`Indent ${r.item.label}`} onClick={() => onChange(rows.map((x, j) => (j === i ? { ...x, depth: 1 } : x)))} disabled={!canIndent(i)}>
                <ArrowRight className="h-4 w-4" />
              </IconAction>
              <IconAction label={`Outdent ${r.item.label}`} onClick={() => onChange(rows.map((x, j) => (j === i ? { ...x, depth: 0 } : x)))} disabled={!canOutdent(i)}>
                <ArrowLeft className="h-4 w-4" />
              </IconAction>
              <IconAction label={`Remove ${r.item.label}`} onClick={() => remove(i)}>
                <TrashIcon className="h-4 w-4" />
              </IconAction>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function countChildrenOfParentAbove(rows: Row[], i: number) {
  let p = i - 1;
  while (p >= 0 && rows[p]!.depth === 1) p--;
  return i - p - 1;
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken hover:text-fg disabled:opacity-35">
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Suggestions for the link fields: real pages, sections and topics. */
function Destinations({ ctx }: { ctx: Ctx }) {
  return (
    <datalist id="nav-destinations">
      {destinations(ctx).map((d) => (
        <option key={d.href} value={d.href}>
          {d.label}
        </option>
      ))}
    </datalist>
  );
}

function destinations(ctx: Ctx) {
  return [
    { href: "/", label: "Home" },
    { href: "/blog", label: "Articles" },
    { href: "/news", label: "News" },
    { href: "/projects", label: "Projects" },
    { href: "/search", label: "Search" },
    { href: "/feed.xml", label: "RSS feed" },
    { href: "/login", label: "Sign in" },
    ...ctx.pages.map((p) => ({ href: p.path, label: p.title })),
    ...ctx.categories.map((c) => ({ href: `/category/${c.slug}`, label: `Topic: ${c.label}` })),
    ...ctx.authors.map((a) => ({ href: `/authors/${a.slug}`, label: `Author: ${a.name}` })),
  ];
}

function AddItem({ ctx, onAdd, disabled }: { ctx: Ctx; onAdd: (item: MenuItem) => void; disabled: boolean }) {
  const options = destinations(ctx);
  const [choice, setChoice] = useState(options[1]!.href);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-muted p-3">
      <label className="min-w-0 flex-1 space-y-1 text-sm">
        <span className="block font-medium text-fg">Add a link to</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className={inputClass}>
          {options.map((o) => (
            <option key={o.href} value={o.href}>
              {o.label} ({o.href})
            </option>
          ))}
          <option value="https://">External link…</option>
        </select>
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          const o = options.find((x) => x.href === choice);
          onAdd({ id: newId("item"), label: o ? o.label.replace(/^(Topic|Author): /, "") : "Link", href: choice === "https://" ? "https://example.com" : choice, newTab: choice === "https://", children: [] });
        }}
      >
        Add item
      </Button>
      {disabled && <p className="w-full text-sm text-fg-subtle">A menu holds at most 12 top-level items.</p>}
    </div>
  );
}

/** What readers will see, at desktop and phone widths. */
function MenuPreview({ items }: { items: MenuItem[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <figure className="min-w-0">
        <figcaption className="mb-2 text-xs font-medium text-fg-subtle">Desktop</figcaption>
        <div className="flex flex-wrap items-center gap-1 overflow-hidden rounded-lg border border-line bg-canvas px-3 py-2" aria-hidden="true">
          {items.map((i) => (
            <span key={i.id} className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-sm font-medium text-fg-muted">
              {i.label || "(no label)"}
              {i.children.length > 0 && <ChevronDown className="h-3.5 w-3.5" />}
            </span>
          ))}
        </div>
      </figure>
      <figure className="min-w-0">
        <figcaption className="mb-2 text-xs font-medium text-fg-subtle">Phone menu</figcaption>
        <ul className="max-w-[16rem] rounded-lg border border-line bg-canvas p-2 text-sm" aria-hidden="true">
          {items.map((i) => (
            <li key={i.id}>
              <span className="block rounded-md px-2 py-1.5 font-medium text-fg">{i.label || "(no label)"}</span>
              {i.children.map((c) => (
                <span key={c.id} className="ml-3 block border-l border-line px-2 py-1 text-fg-muted">
                  {c.label}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </figure>
    </div>
  );
}
