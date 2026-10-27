import { collectionMetadata, CollectionPage } from "@/lib/pages/collection";

export const revalidate = 300;

export const generateMetadata = () => collectionMetadata("news");

export default function Page() {
  return <CollectionPage collection="news" />;
}
