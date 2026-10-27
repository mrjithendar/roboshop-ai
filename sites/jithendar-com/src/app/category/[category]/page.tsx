import { categoryKeys } from "@/config/taxonomy";
import { listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { categoryListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ category: string }> };

export const revalidate = 300;
export const dynamicParams = false;

export const generateStaticParams = () => categoryKeys.map((category) => ({ category }));

export async function generateMetadata({ params }: Props) {
  return listingMetadata(categoryListing((await params).category));
}

export default async function Page({ params }: Props) {
  const listing = categoryListing((await params).category);
  return <ListingPage listing={listing} paged={resolvePage(listing)} />;
}
