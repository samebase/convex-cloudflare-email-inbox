import { z } from "zod";
import type { Infer } from "convex/values";
import type { outboundAttachment } from "./component/messageTypes.js";

export type AttachmentBucket = {
  put: (
    key: string,
    value: ArrayBuffer | Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ) => Promise<unknown>;
};

export function safeFilename(filename: string | null, ordinal: number) {
  const originalFilename = (filename?.split(/[/\\]/).at(-1) || `attachment-${ordinal}`).slice(
    0,
    512,
  );
  const cleaned = Array.from(originalFilename.normalize("NFKC"), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || '<>:"/\\|?*'.includes(character) ? "-" : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 140);
  return { originalFilename, safeFilename: cleaned || `attachment-${ordinal}` };
}

/** Store bytes before enqueueing a message. Repeated content uses the same R2 key. */
export async function storeAttachment(
  bucket: AttachmentBucket,
  input: { filename: string; contentType: string; content: ArrayBuffer },
): Promise<Infer<typeof outboundAttachment>> {
  const metadata = z
    .object({
      filename: z
        .string()
        .min(1)
        .max(512)
        // eslint-disable-next-line no-control-regex -- Reject control characters in stored attachment names.
        .regex(/^[^\x00-\x1f\x7f/\\]+$/),
      contentType: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[^\r\n]+$/),
    })
    .parse(input);
  if (input.content.byteLength > 5 * 1_024 * 1_024) {
    throw new Error("Attachment exceeds the 5 MiB limit");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input.content));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const names = safeFilename(metadata.filename, 1);
  const r2Key = `mail/outbound/${sha256}/${names.safeFilename}`;
  await bucket.put(r2Key, input.content, {
    httpMetadata: { contentType: metadata.contentType },
    customMetadata: { originalFilename: names.originalFilename, sha256 },
  });
  return {
    r2Key,
    filename: names.originalFilename,
    contentType: metadata.contentType,
    byteSize: input.content.byteLength,
    sha256,
  };
}

const objectGrantPayload = z.object({
  expiresAt: z.number().int().positive(),
  r2Key: z.string().min(1).max(1_024),
  filename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
});

export type ObjectGrantPayload = z.infer<typeof objectGrantPayload>;

function encodeBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  if (!secret) throw new Error("An object signing secret is required");
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signature(payload: string, secret: string) {
  const key = await signingKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function createObjectGrant(payload: ObjectGrantPayload, secret: string) {
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(objectGrantPayload.parse(payload))),
  );
  const encodedSignature = encodeBase64Url(await signature(encodedPayload, secret));
  return `${encodedPayload}.${encodedSignature}`;
}

export async function verifyObjectGrant(grant: string, secret: string) {
  try {
    const [encodedPayload, encodedSignature, extra] = grant.split(".");
    if (!encodedPayload || !encodedSignature || extra) {
      return null;
    }
    const actual = decodeBase64Url(encodedSignature);
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await signingKey(secret),
        actual,
        new TextEncoder().encode(encodedPayload),
      ))
    ) {
      return null;
    }
    const parsed = objectGrantPayload.safeParse(
      JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))),
    );
    if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
