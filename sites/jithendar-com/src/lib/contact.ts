import { and, count, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { log } from "./log";
import { sendMail } from "./mail";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { getSettings } from "./settings";
import { verifyTurnstile } from "./turnstile";

export const contactInput = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.email("Enter a valid email").trim().max(200),
  subject: z.string().trim().min(3, "Enter a subject").max(150),
  message: z.string().trim().min(10, "Your message is too short").max(5000),
});

/** Stored in Postgres (contact_message); the admin is notified by email when mail is configured. */
export async function submitContact(raw: unknown, turnstileToken: string | null, ip?: string | null) {
  if (!(await getSettings()).features.contactForm) throw new PostError("The contact form is closed.", 403);
  const parsed = contactInput.safeParse(raw);
  if (!parsed.success) throw new PostError("Please check the form.", 400, parsed.error.issues.map((i) => i.message));
  if (!(await verifyTurnstile(turnstileToken, ip))) throw new PostError("Please complete the human verification again.", 400);
  const db = await getDb();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ mine } = { mine: 0 }] = await db.select({ mine: count() }).from(schema.contactMessage).where(and(gt(schema.contactMessage.createdAt, hourAgo), eq(schema.contactMessage.email, parsed.data.email)));
  const [{ all } = { all: 0 }] = await db.select({ all: count() }).from(schema.contactMessage).where(gt(schema.contactMessage.createdAt, hourAgo));
  if (mine >= 3 || all >= 100) throw new PostError("Too many messages right now. Please try again later.", 400);
  await db.insert(schema.contactMessage).values(parsed.data);
  log.info("contact message received", { subjectLength: parsed.data.subject.length });
  const admins = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.role, "admin"));
  await Promise.all(
    admins.map((a) =>
      sendMail(a.email, `New message: ${parsed.data.subject}`, `From: ${parsed.data.name} <${parsed.data.email}>\n\n${parsed.data.message}\n\nReply from your email client, or read it in Admin → Messages.`),
    ),
  );
}

export async function inbox(status: "new" | "read" | "archived" | "all" = "all") {
  const db = await getDb();
  return db
    .select()
    .from(schema.contactMessage)
    .where(status === "all" ? undefined : eq(schema.contactMessage.status, status))
    .orderBy(desc(schema.contactMessage.createdAt))
    .limit(300);
}

export async function updateMessage(actor: Actor, id: string, action: "read" | "new" | "archived" | "delete") {
  if (actor.role !== "admin") throw new PostError("Only admins can manage messages.", 403);
  const db = await getDb();
  if (action === "delete") await db.delete(schema.contactMessage).where(eq(schema.contactMessage.id, id));
  else await db.update(schema.contactMessage).set({ status: action }).where(eq(schema.contactMessage.id, id));
  await audit(actor, `message.${action}`, id);
}
