import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { categoryListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ category: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  return listingMetadata(await categoryListing((await params).category));
}

export default async function Page({ params }: Props) {
  const listing = await categoryListing((await params).category);
  return <ListingPage listing={listing} paged={resolvePage(listing)} />;
}
