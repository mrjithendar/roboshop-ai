import { categoryKeys } from "@/config/taxonomy";
import { extraPageParams, listingMetadata, ListingPage, resolvePage } from "@/lib/pages/listing";
import { categoryListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ category: string; n: string }> };

export const revalidate = 300;

export const generateStaticParams = () =>
  categoryKeys.flatMap((category) => extraPageParams(categoryListing(category).articles).map(({ n }) => ({ category, n })));

export async function generateMetadata({ params }: Props) {
  const { category, n } = await params;
  const listing = categoryListing(category);
  return listingMetadata(listing, resolvePage(listing, n).page);
}

export default async function Page({ params }: Props) {
  const { category, n } = await params;
  const listing = categoryListing(category);
  return <ListingPage listing={listing} paged={resolvePage(listing, n)} />;
}
