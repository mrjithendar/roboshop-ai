import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { categoryListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ category: string; n: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { category, n } = await params;
  const listing = await categoryListing(category);
  return listingMetadata(listing, resolvePage(listing, n).page);
}

export default async function Page({ params }: Props) {
  const { category, n } = await params;
  const listing = await categoryListing(category);
  return <ListingPage listing={listing} paged={resolvePage(listing, n)} />;
}
