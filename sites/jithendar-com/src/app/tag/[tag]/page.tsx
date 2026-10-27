import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { tagListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ tag: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  return listingMetadata(await tagListing((await params).tag));
}

export default async function Page({ params }: Props) {
  const listing = await tagListing((await params).tag);
  return <ListingPage listing={listing} paged={resolvePage(listing)} />;
}
