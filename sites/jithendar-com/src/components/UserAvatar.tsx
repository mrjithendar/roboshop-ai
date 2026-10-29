import { displayableAvatar, initials } from "@/lib/avatar-url";

const sizes = {
  xs: { box: "h-7 w-7 text-[11px]", px: 28 },
  sm: { box: "h-8 w-8 text-xs", px: 32 },
  md: { box: "h-12 w-12 text-base", px: 48 },
  lg: { box: "h-20 w-20 text-2xl", px: 80 },
};

/**
 * A person's avatar: their uploaded image (or a Google/GitHub one), otherwise initials on the accent tint.
 * Decorative by default: the name is always shown or announced next to it.
 */
export function UserAvatar({ name, image, size = "md", className = "" }: { name: string; image?: string | null; size?: keyof typeof sizes; className?: string }) {
  const s = sizes[size];
  const src = displayableAvatar(image);
  if (src) {
    // Uploaded avatars are already square, small and re-encoded; next/image would add little here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={s.px} height={s.px} referrerPolicy="no-referrer" loading="lazy" decoding="async" className={`shrink-0 rounded-full bg-surface-sunken object-cover ${s.box} ${className}`} />;
  }
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-text ${s.box} ${className}`}>
      {initials(name)}
    </span>
  );
}
