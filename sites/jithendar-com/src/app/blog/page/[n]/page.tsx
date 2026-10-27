import { extraPageParams, listingMetadata, ListingPage, resolvePage, type PageParams } from "@/lib/pages/listing";
import { collectionListing } from "@/lib/pages/listings";

export const revalidate = 300;

export const generateStaticParams = () => extraPageParams(collectionListing("blog").articles);

export async function generateMetadata({ params }: PageParams) {
  const listing = collectionListing("blog");
  return listingMetadata(listing, resolvePage(listing, (await params).n).page);
}

export default async function Page({ params }: PageParams) {
  const listing = collectionListing("blog");
  return <ListingPage listing={listing} paged={resolvePage(listing, (await params).n)} />;
}
