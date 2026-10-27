import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { log } from "./log";
import type { Actor } from "./posts";
import { PostError } from "./posts";
import { seal, unseal, type Sealed } from "./secrets";

/**
 * Outgoing email. Primary: Amazon SES, configured by an admin (Admin → Storage & email), keys encrypted at rest.
 * Fallback: SMTP_URL + MAIL_FROM environment variables. Neither configured → mail is skipped (logged).
 */
const EMAIL_KEY = "email";

type EmailConfig = { provider: "ses"; region: string; from: string; accessKeyId: string; secretAccessKey: Sealed; verifiedAt: string | null };

export const emailInput = z.object({
  region: z.string().trim().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "e.g. us-east-1"),
  from: z.string().trim().min(5).max(200),
  accessKeyId: z.string().trim().min(3).max(200),
  secretAccessKey: z.string().max(400).default(""),
});

async function readConfig(): Promise<EmailConfig | null> {
  try {
    const db = await getDb();
    const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, EMAIL_KEY));
    return (row?.value as EmailConfig | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function emailSummary() {
  const c = await readConfig();
  if (!c) return null;
  const { secretAccessKey: _s, ...rest } = c;
  void _s;
  return rest;
}

export async function mailConfigured(): Promise<boolean> {
  return Boolean((await readConfig())?.verifiedAt) || Boolean(process.env.SMTP_URL && process.env.MAIL_FROM);
}

async function sendWith(c: EmailConfig, to: string, subject: string, text: string) {
  const ses = new SESv2Client({ region: c.region, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: unseal(c.secretAccessKey) } });
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: c.from,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: text, Charset: "UTF-8" } } } },
    }),
  );
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  try {
    const c = await readConfig();
    if (c?.verifiedAt) {
      await sendWith(c, to, subject, text);
      return true;
    }
    if (process.env.SMTP_URL && process.env.MAIL_FROM) {
      await nodemailer.createTransport(process.env.SMTP_URL).sendMail({ from: process.env.MAIL_FROM, to, subject, text });
      return true;
    }
    log.warn("email not configured; message not sent", { subject });
    return false;
  } catch (error) {
    log.error("mail send failed", { err: error, subject });
    return false;
  }
}

/** Save SES settings and prove them by sending a test email to `testTo`. Mail stays off until that succeeds. */
export async function saveEmailConfig(actor: Actor, raw: unknown, testTo: string): Promise<{ verified: boolean; error?: string }> {
  if (actor.role !== "admin") throw new PostError("Only admins can configure email.", 403);
  const parsed = emailInput.safeParse(raw);
  if (!parsed.success) throw new PostError("The email settings are not valid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const existing = await readConfig();
  if (!parsed.data.secretAccessKey && !existing) throw new PostError("Enter the secret access key.", 400);
  const config: EmailConfig = {
    provider: "ses",
    region: parsed.data.region,
    from: parsed.data.from,
    accessKeyId: parsed.data.accessKeyId,
    secretAccessKey: parsed.data.secretAccessKey ? seal(parsed.data.secretAccessKey) : existing!.secretAccessKey,
    verifiedAt: null,
  };
  let error: string | undefined;
  try {
    await sendWith(config, testTo, "Jithendar.com email is working", "Amazon SES is configured correctly for Jithendar.com.");
    config.verifiedAt = new Date().toISOString();
  } catch (e) {
    error = (e as Error).message;
  }
  const db = await getDb();
  await db
    .insert(schema.setting)
    .values({ key: EMAIL_KEY, value: config, updatedBy: actor.id })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: config, updatedBy: actor.id, updatedAt: new Date() } });
  await audit(actor, "email.configure", config.from, { region: config.region, verified: !error });
  return { verified: !error, error };
}
