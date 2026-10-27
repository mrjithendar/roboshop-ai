import { deletePost, getPostRow, updatePost } from "@/lib/posts";
import { api, json, serialize } from "../../_lib";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  return api(request, "posts:read", async ({ actor }) => serialize(await getPostRow(actor, id)));
}

/** Partial update: only the fields you send change. Changing the slug records a redirect. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return api(request, "posts:write", async ({ actor }) => serialize(await updatePost(actor, id, await json(request))));
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { id } = await params;
  return api(request, "posts:write", async ({ actor }) => {
    await deletePost(actor, id);
    return undefined;
  });
}
