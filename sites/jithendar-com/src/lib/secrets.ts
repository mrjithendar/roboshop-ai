import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isProductionEnv } from "@/config/site";

/**
 * Encrypt credentials stored in the database (S3 keys, backup destinations) with AES-256-GCM.
 * Key: SETTINGS_ENCRYPTION_KEY (any long random string; hashed to 32 bytes). Rotating it makes
 * stored credentials unreadable, so they must be re-entered.
 */
function key(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    if (isProductionEnv()) throw new Error("SETTINGS_ENCRYPTION_KEY (32+ characters) is required in production.");
    return createHash("sha256").update("development-only-settings-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export type Sealed = { v: 1; iv: string; tag: string; data: string };

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function unseal(sealed: Sealed): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
}

/** Encrypt arbitrary bytes with a passphrase (backups): scrypt-derived key, AES-256-GCM, self-describing header. */
export async function encryptWithPassphrase(plain: Buffer, passphrase: string): Promise<Buffer> {
  const { scrypt } = await import("node:crypto");
  const salt = randomBytes(16);
  const k = await new Promise<Buffer>((res, rej) => scrypt(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, d) => (e ? rej(e) : res(d))));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  // "JKBK1" | salt(16) | iv(12) | tag(16) | ciphertext
  return Buffer.concat([Buffer.from("JKBK1"), salt, iv, cipher.getAuthTag(), body]);
}

export async function decryptWithPassphrase(blob: Buffer, passphrase: string): Promise<Buffer> {
  if (blob.subarray(0, 5).toString() !== "JKBK1") throw new Error("Not a Jithendar.com backup file.");
  const { scrypt } = await import("node:crypto");
  const salt = blob.subarray(5, 21);
  const iv = blob.subarray(21, 33);
  const tag = blob.subarray(33, 49);
  const k = await new Promise<Buffer>((res, rej) => scrypt(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, d) => (e ? rej(e) : res(d))));
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(49)), decipher.final()]);
}
