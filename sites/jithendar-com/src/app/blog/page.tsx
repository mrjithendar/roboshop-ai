import { collectionMetadata, CollectionPage } from "@/lib/pages/collection";

export const revalidate = 300;

export const generateMetadata = () => collectionMetadata("blog");

export default function Page() {
  return <CollectionPage collection="blog" />;
}
