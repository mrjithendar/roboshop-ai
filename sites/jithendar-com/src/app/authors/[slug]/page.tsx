import { getAuthors } from "@/lib/content";
import { authorMetadata, AuthorProfilePage } from "@/lib/pages/author";
import { resolvePage } from "@/lib/pages/listing";
import { authorListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 300;
export const dynamicParams = false;

export const generateStaticParams = () => getAuthors().map((a) => ({ slug: a.slug }));

export async function generateMetadata({ params }: Props) {
  return authorMetadata((await params).slug);
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  return <AuthorProfilePage slug={slug} paged={resolvePage(authorListing(slug))} />;
}
