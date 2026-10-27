import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { collectionListing } from "@/lib/pages/listings";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => listingMetadata(await collectionListing("blog"));

export default async function Page() {
  const listing = await collectionListing("blog");
  return <ListingPage listing={listing} paged={resolvePage(listing)} />;
}
