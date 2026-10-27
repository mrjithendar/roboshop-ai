import { listingMetadata, ListingPage, resolvePage, type PageParams } from "@/lib/pages/listing";
import { collectionListing } from "@/lib/pages/listings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageParams) {
  const listing = await collectionListing("blog");
  return listingMetadata(listing, resolvePage(listing, (await params).n).page);
}

export default async function Page({ params }: PageParams) {
  const listing = await collectionListing("blog");
  return <ListingPage listing={listing} paged={resolvePage(listing, (await params).n)} />;
}
