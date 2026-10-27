import { createElement, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const RssIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14" />
    <circle cx="6" cy="18" r="1" fill="currentColor" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const GitHubIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
  </svg>
);

export const LinkedInIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
  </svg>
);

export const CheckBadge = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l2.4 1.6 2.9-.2.9 2.8 2.3 1.8-1 2.7 1 2.7-2.3 1.8-.9 2.8-2.9-.2L12 21l-2.4-1.6-2.9.2-.9-2.8-2.3-1.8 1-2.7-1-2.7 2.3-1.8.9-2.8 2.9.2Z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

/** Category icons by name (the admin picks one per category). */
export const categoryIcons: Record<string, (p: IconProps) => React.JSX.Element> = {
  chip: (p) => (
    <Icon {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
      <path d="M10 10h4v4h-4z" />
    </Icon>
  ),
  bot: (p) => (
    <Icon {...p}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" />
      <circle cx="12" cy="3.5" r="1" />
    </Icon>
  ),
  flow: (p) => (
    <Icon {...p}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7 6h10M6 8l5 8.3M18 8l-5 8.3" />
    </Icon>
  ),
  cloud: (p) => (
    <Icon {...p}>
      <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 10a4 4 0 0 0 1 8Z" />
    </Icon>
  ),
  wheel: (p) => (
    <Icon {...p}>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 5.5V9M12 15v3.5M6.2 8.8 9.4 10.5M14.6 13.5l3.2 1.7M6.2 15.2l3.2-1.7M14.6 10.5l3.2-1.7" />
    </Icon>
  ),
  loop: (p) => (
    <Icon {...p}>
      <path d="M7.5 8C4.5 8 3 10 3 12s1.5 4 4.5 4C11 16 13 8 16.5 8 19.5 8 21 10 21 12s-1.5 4-4.5 4C13 16 11 8 7.5 8Z" />
    </Icon>
  ),
  code: (p) => (
    <Icon {...p}>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </Icon>
  ),
  shield: (p) => (
    <Icon {...p}>
      <path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  layers: (p) => (
    <Icon {...p}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </Icon>
  ),
  book: (p) => (
    <Icon {...p}>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
      <path d="M8 7h7" />
    </Icon>
  ),
  database: (p) => (
    <Icon {...p}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </Icon>
  ),
  network: (p) => (
    <Icon {...p}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v5M12 12l-6 5M12 12l6 5" />
    </Icon>
  ),
};

export const iconNames = Object.keys(categoryIcons);

/** Icon for a category's icon name, with a neutral fallback. */
export function iconFor(name: string) {
  return categoryIcons[name] ?? categoryIcons.layers!;
}

/** Render a category's icon by name (one stable component, so React never sees a new type per render). */
export function CategoryIcon({ name, ...props }: IconProps & { name: string }) {
  return createElement(iconFor(name), props);
}
