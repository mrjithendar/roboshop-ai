"use client";

import { useId, useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "../icons";
import { THEME_KEY } from "./script";

type Choice = "light" | "dark" | "system";

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = media();
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}

function readChoice(): Choice {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

function apply(choice: Choice) {
  const root = document.documentElement;
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage blocked: the choice still applies for this page view */
  }
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  listeners.forEach((l) => l());
}

/** Resolved theme ("light" | "dark") and the stored choice; server snapshot renders as system/light. */
function useTheme() {
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as Choice);
  const dark = useSyncExternalStore(
    subscribe,
    () => (choice === "system" ? media().matches : choice === "dark"),
    () => false,
  );
  return { choice, dark };
}

/** Header icon button: flips between light and dark (an explicit, remembered choice). */
export function ThemeToggle() {
  const { dark } = useTheme();
  return (
    <button
      type="button"
      onClick={() => apply(dark ? "light" : "dark")}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {/* Both icons render; CSS picks one, so the server HTML is right before hydration. */}
      <SunIcon className="hidden h-5 w-5 dark:block" />
      <MoonIcon className="h-5 w-5 dark:hidden" />
    </button>
  );
}

const options: { value: Choice; label: string; Icon: typeof SunIcon }[] = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/** Footer segmented control, including "System" to drop an explicit choice. */
export function ThemeSelect() {
  const { choice } = useTheme();
  // Unique group name: the control appears in both the footer and the mobile menu.
  const name = useId();
  return (
    <fieldset className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
      <legend className="sr-only">Theme</legend>
      {options.map(({ value, label, Icon }) => (
        <label
          key={value}
          className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg has-[:checked]:bg-surface-sunken has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
        >
          <input type="radio" name={name} value={value} checked={choice === value} onChange={() => apply(value)} className="sr-only" />
          <Icon className="h-3.5 w-3.5" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
