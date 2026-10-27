import nodemailer from "nodemailer";
import { log } from "./log";

/** Outgoing mail is optional: SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) + MAIL_FROM. */
export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL && process.env.MAIL_FROM);
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    const transport = nodemailer.createTransport(process.env.SMTP_URL);
    await transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
    return true;
  } catch (error) {
    log.error("mail send failed", { err: error });
    return false;
  }
}
