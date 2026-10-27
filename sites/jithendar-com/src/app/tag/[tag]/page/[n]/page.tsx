import { publishedTags } from "@/lib/content";
import { extraPageParams, listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { tagListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ tag: string; n: string }> };

export const revalidate = 300;

export const generateStaticParams = () =>
  publishedTags().flatMap((t) => extraPageParams(tagListing(t.slug).articles).map(({ n }) => ({ tag: t.slug, n })));

export async function generateMetadata({ params }: Props) {
  const { tag, n } = await params;
  const listing = tagListing(tag);
  return listingMetadata(listing, resolvePage(listing, n).page);
}

export default async function Page({ params }: Props) {
  const { tag, n } = await params;
  const listing = tagListing(tag);
  return <ListingPage listing={listing} paged={resolvePage(listing, n)} />;
}
