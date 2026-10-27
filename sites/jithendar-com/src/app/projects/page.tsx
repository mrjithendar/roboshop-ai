import { collectionMetadata, CollectionPage } from "@/lib/pages/collection";

export const revalidate = 300;

export const generateMetadata = () => collectionMetadata("projects");

export default function Page() {
  return <CollectionPage collection="projects" />;
}
