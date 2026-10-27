import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  return (await getAuth()).handler(request);
}

export { handle as GET, handle as POST };
