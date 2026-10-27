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
