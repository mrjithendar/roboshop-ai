import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { collectionListing } from "@/lib/pages/listings";

export const revalidate = 300;

export const generateMetadata = () => listingMetadata(collectionListing("blog"));

export default function Page() {
  const listing = collectionListing("blog");
  return <ListingPage listing={listing} paged={resolvePage(listing)} />;
}
