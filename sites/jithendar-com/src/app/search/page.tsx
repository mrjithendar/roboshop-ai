import type { Metadata } from "next";
import { absoluteUrl } from "@/config/site";
import { SearchBox } from "./SearchBox";

export const metadata: Metadata = {
  title: "Search",
  description: "Search published articles, news and projects on Jithendar.com.",
  alternates: { canonical: absoluteUrl("/search") },
  // Search result pages are not useful in search engines.
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight">Search</h1>
      <div className="mt-6">
        <SearchBox />
      </div>
    </div>
  );
}
