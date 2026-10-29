import { integrations } from "@/config/integrations";
import { isProductionEnv, PRODUCTION_HOST, siteUrl } from "@/config/site";
import { enqueue, PermanentJobError } from "./jobs";
import { log } from "./log";

/**
 * IndexNow (indexnow.org): tells participating search engines (e.g. Bing, Yandex, Seznam, Naver)
 * that a URL was added, updated or deleted. Google does not take part. The key is served at
 * https://jithendar.com/{INDEXNOW_KEY}.txt by src/proxy.ts. Submissions go through the job queue,
 * so publishing never waits on, or fails because of, an IndexNow outage.
 */
const ENDPOINT = "https://api.indexnow.org/indexnow";

export async function submitIndexNow(urls: string[], opts: { key: string; host?: string; endpoint?: string; fetchImpl?: typeof fetch }) {
  const host = opts.host ?? PRODUCTION_HOST;
  const res = await (opts.fetchImpl ?? fetch)(opts.endpoint ?? process.env.INDEXNOW_ENDPOINT ?? ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key: opts.key, keyLocation: `https://${host}/${opts.key}.txt`, urlList: urls }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 200 || res.status === 202) return res.status;
  // 400 bad request, 403 key not valid, 422 URLs not on this host: retrying will not help.
  if (res.status === 400 || res.status === 403 || res.status === 422) throw new PermanentJobError(`IndexNow rejected the submission (HTTP ${res.status})`);
  throw new Error(`IndexNow HTTP ${res.status}`);
}

/** Queue canonical public URLs on this site (deduplicated while pending). No-op unless production and configured. */
export async function queueIndexNow(paths: string[]): Promise<number> {
  const key = integrations().indexNowKey;
  if (!key || !isProductionEnv()) return 0;
  let queued = 0;
  for (const path of new Set(paths)) {
    if (!path.startsWith("/") || path.startsWith("//")) continue;
    const url = `${siteUrl()}${path}`;
    try {
      if (await enqueue("indexnow", { url }, { dedupeKey: `indexnow:${url}`, maxAttempts: 6 })) queued++;
    } catch (error) {
      log.warn("could not queue IndexNow submission", { url, err: error });
    }
  }
  return queued;
}

export const indexNowHandler = async (payload: Record<string, unknown>) => {
  const key = integrations().indexNowKey;
  if (!key) throw new PermanentJobError("INDEXNOW_KEY is not configured");
  await submitIndexNow([String(payload.url)], { key });
};
