import { z } from "zod";

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

async function signature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function createObjectGrant(payload: ObjectGrantPayload, secret: string) {
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const encodedSignature = encodeBase64Url(await signature(encodedPayload, secret));
  return `${encodedPayload}.${encodedSignature}`;
}

export async function verifyObjectGrant(grant: string, secret: string) {
  try {
    const [encodedPayload, encodedSignature, extra] = grant.split(".");
    if (!encodedPayload || !encodedSignature || extra) {
      return null;
    }
    const expected = await signature(encodedPayload, secret);
    const actual = decodeBase64Url(encodedSignature);
    if (actual.byteLength !== expected.byteLength) {
      return null;
    }
    let difference = 0;
    for (let index = 0; index < actual.byteLength; index += 1) {
      difference |= actual[index] ^ expected[index];
    }
    if (difference !== 0) {
      return null;
    }
    const parsed = objectGrantPayload.safeParse(
      JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))),
    );
    if (!parsed.success || parsed.data.expiresAt < Date.now()) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
