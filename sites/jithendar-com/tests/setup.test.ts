import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTests } from "@/db";
import { freshDb } from "./db-helpers";

vi.mock("server-only", () => ({}));

afterEach(() => setDbForTests(undefined));

describe("setup: first admin", () => {
  it("creates a new admin when the email is unused", async () => {
    const db = await freshDb();
    const { createOrPromoteAdmin } = await import("@/lib/setup");
    const id = await createOrPromoteAdmin(db, { name: "Owner", email: "owner@example.com", hash: "h1" });
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, id));
    expect(u).toMatchObject({ role: "admin", emailVerified: true });
    const accounts = await db.select().from(schema.account).where(eq(schema.account.userId, id));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.password).toBe("h1");
  });

  it("promotes an existing reader account with the same email, resets its password and ends its sessions", async () => {
    const db = await freshDb();
    await db.insert(schema.user).values({ id: "reader", name: "Reader", email: "owner@example.com", role: "user" });
    await db.insert(schema.account).values({ id: "acc", accountId: "reader", providerId: "credential", userId: "reader", password: "old" });
    await db.insert(schema.session).values({ id: "s1", token: "t1", userId: "reader", expiresAt: new Date(Date.now() + 3_600_000) });
    const { createOrPromoteAdmin } = await import("@/lib/setup");
    const id = await createOrPromoteAdmin(db, { name: "Owner", email: "owner@example.com", hash: "new" });
    expect(id).toBe("reader");
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, "reader"));
    expect(u).toMatchObject({ role: "admin", emailVerified: true, name: "Owner" });
    const [acc] = await db.select().from(schema.account).where(eq(schema.account.userId, "reader"));
    expect(acc!.password).toBe("new");
    expect(await db.select().from(schema.session).where(eq(schema.session.userId, "reader"))).toHaveLength(0);
    expect(await db.select().from(schema.user)).toHaveLength(1);
  });
});
