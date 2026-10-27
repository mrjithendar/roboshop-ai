import { authorMetadata, AuthorProfilePage } from "@/lib/pages/author";
import { resolvePage } from "@/lib/pages/listing";
import { authorListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ slug: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  return authorMetadata((await params).slug);
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  return <AuthorProfilePage slug={slug} paged={resolvePage(await authorListing(slug))} />;
}
