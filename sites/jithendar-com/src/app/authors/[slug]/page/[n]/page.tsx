import { authorMetadata, AuthorProfilePage } from "@/lib/pages/author";
import { resolvePage } from "@/lib/pages/listing";
import { authorListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ slug: string; n: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { slug, n } = await params;
  return authorMetadata(slug, resolvePage(await authorListing(slug), n).page);
}

export default async function Page({ params }: Props) {
  const { slug, n } = await params;
  return <AuthorProfilePage slug={slug} paged={resolvePage(await authorListing(slug), n)} />;
}
