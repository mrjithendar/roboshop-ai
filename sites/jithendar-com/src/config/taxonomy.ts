/** Single source of truth for categories, content types and which collection may hold which type. */

export const categories = {
  "ai-engineering": "AI Engineering",
  "ai-agents": "AI Agents, MCP & LLMOps",
  "mlops": "MLOps",
  "aws-cloud": "AWS & Cloud",
  "kubernetes": "Kubernetes & Cloud Native",
  "devops-sre": "DevOps, SRE & Platform Engineering",
  "infrastructure-as-code": "Infrastructure as Code",
  "cybersecurity": "Cybersecurity",
} as const;

export type Category = keyof typeof categories;
export const categoryKeys = Object.keys(categories) as [Category, ...Category[]];

/** Unique intro text per category page. A category page without an intro is never indexed. */
export const categoryIntros: Record<Category, string> = {
  "ai-engineering":
    "Building production systems on large language models: retrieval, evaluation, guardrails, cost and latency, and the engineering trade-offs behind them.",
  "ai-agents":
    "Agents, tool use and the Model Context Protocol, plus the LLMOps practices that keep them observable, testable and safe to run.",
  "mlops":
    "Training, packaging, serving and monitoring models, with an emphasis on reproducible pipelines and operational reliability.",
  "aws-cloud":
    "AWS services and cloud architecture in practice: networking, identity, cost, managed Kubernetes and the release notes that matter.",
  "kubernetes":
    "Kubernetes and the cloud-native ecosystem: cluster operations, GitOps with Argo CD, ingress, certificates and workload security.",
  "devops-sre":
    "CI/CD, reliability engineering and internal platforms: how teams ship safely, measure service health and recover from failure.",
  "infrastructure-as-code":
    "Terraform, Helm, Kustomize and friends: declaring infrastructure, reviewing changes and keeping environments reproducible.",
  "cybersecurity":
    "Vulnerabilities, advisories and hardening for cloud and Kubernetes workloads, from supply chain to runtime.",
};

/** Topic pairs whose articles are suggested to each other as related reading. Suggestions only. */
export const relatedCategories: ReadonlyArray<readonly [Category, Category]> = [
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
  blog: "Blog",
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
