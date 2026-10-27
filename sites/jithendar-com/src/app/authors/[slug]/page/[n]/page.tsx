import { getAuthors } from "@/lib/content";
import { authorMetadata, AuthorProfilePage } from "@/lib/pages/author";
import { extraPageParams, resolvePage } from "@/lib/pages/listing";
import { authorListing } from "@/lib/pages/listings";

type Props = { params: Promise<{ slug: string; n: string }> };

export const revalidate = 300;

export const generateStaticParams = () =>
  getAuthors().flatMap((a) => extraPageParams(authorListing(a.slug).articles).map(({ n }) => ({ slug: a.slug, n })));

export async function generateMetadata({ params }: Props) {
  const { slug, n } = await params;
  return authorMetadata(slug, resolvePage(authorListing(slug), n).page);
}

export default async function Page({ params }: Props) {
  const { slug, n } = await params;
  return <AuthorProfilePage slug={slug} paged={resolvePage(authorListing(slug), n)} />;
}
