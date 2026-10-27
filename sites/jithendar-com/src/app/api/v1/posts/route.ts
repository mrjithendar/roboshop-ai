import { collections, type Collection } from "@/config/taxonomy";
import { createPost, listPosts } from "@/lib/posts";
import { api, json, serialize } from "../_lib";

export const dynamic = "force-dynamic";

/** GET /api/v1/posts?status=&collection=&limit=&offset= (scope posts:read) */
export function GET(request: Request) {
  return api(request, "posts:read", async ({ actor }) => {
    const q = new URL(request.url).searchParams;
    const collection = (collections as readonly string[]).includes(q.get("collection") ?? "") ? (q.get("collection") as Collection) : undefined;
    const rows = await listPosts(actor, {
      status: q.get("status") ?? undefined,
      collection,
      limit: Number(q.get("limit") ?? 50) || 50,
      offset: Number(q.get("offset") ?? 0) || 0,
    });
    return rows.map(serialize);
  });
}

/** POST /api/v1/posts (scope posts:write): same validation as the editor. */
export function POST(request: Request) {
  return api(request, "posts:write", async ({ actor }) => serialize(await createPost(actor, await json(request))), 201);
}
