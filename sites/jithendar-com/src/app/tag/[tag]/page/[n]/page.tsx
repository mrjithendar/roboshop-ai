import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { tagListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ tag: string; n: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { tag, n } = await params;
  const listing = await tagListing(tag);
  return listingMetadata(listing, resolvePage(listing, n).page);
}

export default async function Page({ params }: Props) {
  const { tag, n } = await params;
  const listing = await tagListing(tag);
  return <ListingPage listing={listing} paged={resolvePage(listing, n)} />;
}
