import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/form";
import { avatarLimits } from "@/lib/avatar";
import { formatDate } from "@/lib/dates";
import { getAccountProfile, PROFILE_LIMITS } from "@/lib/profile";
import { requireUser } from "@/lib/session";
import { storageReady } from "@/lib/storage";
import { AvatarEditor } from "./AvatarEditor";
import { ProfileForm } from "./ProfileForm";
import { Section } from "./Section";

export const metadata: Metadata = { title: "Profile" };

export default async function AccountProfilePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser("/account");
  const profile = await getAccountProfile(user.id);
  if (!profile) notFound();
  const { denied } = await searchParams;
  const staff = profile.role === "admin" || profile.role === "author";
  const limits = avatarLimits();

  return (
    <div className="space-y-6">
      {denied && <Alert>Your account does not have access to that area.</Alert>}

      <Section id="avatar-title" title="Avatar" description="Shown in the header and next to your comments.">
        <AvatarEditor name={profile.name} image={profile.image} enabled={await storageReady()} maxMb={Math.round((limits.maxBytes / (1024 * 1024)) * 10) / 10} />
      </Section>

      <Section id="profile-title" title="Profile" description="Your display name appears next to your comments. Your bio and links stay private to your account.">
        <ProfileForm
          limits={PROFILE_LIMITS}
          initial={{
            name: profile.name,
            bio: profile.bio,
            website: profile.website ?? "",
            github: profile.socialLinks.github ?? "",
            linkedin: profile.socialLinks.linkedin ?? "",
            x: profile.socialLinks.x ?? "",
          }}
        />
      </Section>

      <Section id="details-title" title="Account details">
        <dl className="divide-y divide-line text-[0.9375rem]">
          {[
            ["Email", profile.email],
            ["Email verified", profile.emailVerified ? "Yes" : "No"],
            ["Role", staff ? (profile.role === "admin" ? "Administrator" : "Author") : "Reader"],
            ["Member since", formatDate(profile.createdAt.toISOString())],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-6">
              <dt className="text-fg-subtle">{k}</dt>
              <dd className="min-w-0 font-medium text-fg [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
        {staff && (
          <p className="mt-4 text-sm leading-6 text-fg-muted">
            Your public author byline (name, job title, bio and profile links on articles) is separate and edited in{" "}
            <Link href="/admin/profile" className="link">
              Admin → Author profile
            </Link>
            .
          </p>
        )}
      </Section>
    </div>
  );
}
