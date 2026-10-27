import { serializeJsonLd } from "@/lib/seo/jsonld";

type Props = { data: Parameters<typeof serializeJsonLd>[0] };

export function JsonLd({ data }: Props) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
