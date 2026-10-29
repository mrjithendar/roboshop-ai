import { createHash } from "node:crypto";

/** In-memory stand-in for the R2 functions in @/lib/storage (no network). */
export function fakeR2() {
  const objects = new Map<string, { body: Buffer; contentType: string; cacheControl?: string }>();
  const body = (b: Buffer) => ({
    transformToByteArray: async () => new Uint8Array(b),
    transformToWebStream: () => new Blob([new Uint8Array(b)]).stream(),
    async *[Symbol.asyncIterator]() {
      // Two chunks, to exercise streaming checksum code.
      yield new Uint8Array(b.subarray(0, Math.min(16, b.length)));
      if (b.length > 16) yield new Uint8Array(b.subarray(16));
    },
  });
  const api = {
    objects,
    storageReady: async () => true,
    putObject: async (key: string, b: Buffer, opts: { contentType: string; cacheControl?: string; contentMd5?: string }) => {
      if (opts.contentMd5 && opts.contentMd5 !== createHash("md5").update(b).digest("base64")) throw new Error("BadDigest");
      objects.set(key, { body: b, contentType: opts.contentType, cacheControl: opts.cacheControl });
    },
    headObject: async (key: string) => {
      const o = objects.get(key);
      return o ? { size: o.body.length, contentType: o.contentType } : null;
    },
    getObject: async (key: string) => {
      const o = objects.get(key);
      return o ? { Body: body(o.body), ContentLength: o.body.length, ContentType: o.contentType } : null;
    },
    deleteObject: async (key: string) => {
      objects.delete(key);
    },
    copyObject: async (from: string, to: string, opts: { contentType: string }) => {
      const o = objects.get(from);
      if (!o) throw new Error("NoSuchKey");
      objects.set(to, { ...o, contentType: opts.contentType });
    },
    presignPut: async (key: string) => `https://r2.test/${key}?X-Amz-Signature=fake`,
    presignGet: async (key: string) => `https://r2.test/${key}?X-Amz-Signature=get`,
    publicObjectUrl: async () => null,
  };
  return api;
}

/** Smallest valid images for content sniffing and dimension checks. */
export const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const JPEG_1x1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
