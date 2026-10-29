import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { PageHeader } from "@/components/PageHeader";
import { absoluteUrl } from "@/config/site";
import { SearchBox } from "./SearchBox";

// Rendered per request so runtime integration settings (GA4, verification) apply here too.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  description: "Search published articles, news and projects on Jithendar.com.",
  alternates: { canonical: absoluteUrl("/search") },
  // Search result pages are not useful in search engines.
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <>
      <PageHeader title="Search" description="Find articles, news and projects by title, topic or tag." eyebrow="Archive" narrow />
      <Container narrow className="py-12">
        <SearchBox />
      </Container>
    </>
  );
}
