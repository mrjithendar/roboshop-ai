import { extraPageParams, listingMetadata, ListingPage, resolvePage, type PageParams } from "@/lib/pages/listing";
import { collectionListing } from "@/lib/pages/listings";

export const revalidate = 300;

export const generateStaticParams = () => extraPageParams(collectionListing("projects").articles);

export async function generateMetadata({ params }: PageParams) {
  const listing = collectionListing("projects");
  return listingMetadata(listing, resolvePage(listing, (await params).n).page);
}

export default async function Page({ params }: PageParams) {
  const listing = collectionListing("projects");
  return <ListingPage listing={listing} paged={resolvePage(listing, (await params).n)} />;
}
