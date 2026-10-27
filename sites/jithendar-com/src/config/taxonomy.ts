/** Single source of truth for categories, content types and which collection may hold which type. */

export type CategoryInfo = { slug: string; label: string; intro: string; icon: string; tone: string; sort: number };

/**
 * Built-in categories: the seed for the editable `category` table and the fallback when the
 * database is empty or unavailable (tests, file-based content). Admins/authors manage the live list.
 */
export const defaultCategories: CategoryInfo[] = [
  { slug: "ai-engineering", label: "AI Engineering", icon: "chip", tone: "violet", intro: "Building production systems on large language models: retrieval, evaluation, guardrails, cost and latency, and the engineering trade-offs behind them." },
  { slug: "ai-agents", label: "AI Agents, MCP & LLMOps", icon: "bot", tone: "fuchsia", intro: "Agents, tool use and the Model Context Protocol, plus the LLMOps practices that keep them observable, testable and safe to run." },
  { slug: "mlops", label: "MLOps", icon: "flow", tone: "indigo", intro: "Training, packaging, serving and monitoring models, with an emphasis on reproducible pipelines and operational reliability." },
  { slug: "aws-cloud", label: "AWS & Cloud", icon: "cloud", tone: "amber", intro: "AWS services and cloud architecture in practice: networking, identity, cost, managed Kubernetes and the release notes that matter." },
  { slug: "kubernetes", label: "Kubernetes & Cloud Native", icon: "wheel", tone: "sky", intro: "Kubernetes and the cloud-native ecosystem: cluster operations, GitOps with Argo CD, ingress, certificates and workload security." },
  { slug: "devops-sre", label: "DevOps, SRE & Platform Engineering", icon: "loop", tone: "emerald", intro: "CI/CD, reliability engineering and internal platforms: how teams ship safely, measure service health and recover from failure." },
  { slug: "infrastructure-as-code", label: "Infrastructure as Code", icon: "code", tone: "teal", intro: "Terraform, Helm, Kustomize and friends: declaring infrastructure, reviewing changes and keeping environments reproducible." },
  { slug: "cybersecurity", label: "Cybersecurity", icon: "shield", tone: "rose", intro: "Vulnerabilities, advisories and hardening for cloud and Kubernetes workloads, from supply chain to runtime." },
].map((c, i) => ({ ...c, sort: (i + 1) * 10 }));

export type Category = string;

/** Topic pairs whose articles are suggested to each other as related reading. Suggestions only. */
export const relatedCategories: ReadonlyArray<readonly [string, string]> = [
  ["aws-cloud", "infrastructure-as-code"],
  ["kubernetes", "devops-sre"],
  ["kubernetes", "infrastructure-as-code"],
  ["ai-engineering", "ai-agents"],
  ["ai-agents", "mlops"],
  ["cybersecurity", "kubernetes"],
];

export const contentTypes = {
  news: "News",
  analysis: "Analysis",
  tutorial: "Tutorial",
  opinion: "Opinion",
  project: "Project",
  curated: "Curated summary",
} as const;

export type ContentType = keyof typeof contentTypes;
export const contentTypeKeys = Object.keys(contentTypes) as [ContentType, ...ContentType[]];

export const collections = ["blog", "news", "projects"] as const;
export type Collection = (typeof collections)[number];

export const collectionLabels: Record<Collection, string> = {
  blog: "Articles",
  news: "News",
  projects: "Projects",
};

export const allowedTypes: Record<Collection, readonly ContentType[]> = {
  blog: ["analysis", "tutorial", "opinion", "curated"],
  news: ["news", "analysis"],
  projects: ["project"],
};

/** Content types that must cite at least one source. */
export const typesRequiringSources: readonly ContentType[] = ["news", "curated"];

/** Content types eligible for the Google News sitemap. */
export const newsSitemapTypes: readonly ContentType[] = ["news", "analysis"];

/** Taxonomy pages with fewer items than this render noindex and stay out of the sitemap. */
export const MIN_INDEXABLE_TAXONOMY_ITEMS = 3;

export const PAGE_SIZE = 12;

/** URL-safe slug for a tag ("Argo CD" → "argo-cd"). */
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}
