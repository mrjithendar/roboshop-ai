import { publishedTags } from "@/lib/content";
import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { tagListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ tag: string }> };

export const revalidate = 300;

export const generateStaticParams = () => publishedTags().map((t) => ({ tag: t.slug }));

export async function generateMetadata({ params }: Props) {
  return listingMetadata(tagListing((await params).tag));
}

export default async function Page({ params }: Props) {
  const listing = tagListing((await params).tag);
  return <ListingPage listing={listing} paged={resolvePage(listing)} />;
}
