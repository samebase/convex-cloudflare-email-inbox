import { z } from "zod";

export const mailAddress = z.string().trim().toLowerCase().email().max(320);
const envelopeSender = z.union([z.literal(""), mailAddress]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const shortText = z.string().max(998);
const body = z.object({
  content: z.string().max(524_288),
  originalByteCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
const attachment = z.object({
  ordinal: z.number().int().min(1).max(200),
  r2Key: z.string().min(1).max(1_024),
  originalFilename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative().max(26_214_400),
});

export const beginIngressRequest = z.object({
  version: z.literal(1),
  recipient: mailAddress,
  ingressKey: digest,
  envelopeFrom: envelopeSender,
  rawSize: z.number().int().nonnegative().max(26_214_400),
  receivedAt: z.number().int().positive(),
});

export const beginIngressResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ingest"), rawR2Key: z.string().min(1).max(1_024) }),
  z.object({ kind: z.literal("duplicate") }),
  z.object({ kind: z.literal("reject"), reason: z.literal("unknown") }),
]);

export const completeIngressRequest = z.object({
  version: z.literal(1),
  recipient: mailAddress,
  ingressKey: digest,
  parse: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("parsed") }),
    z.object({ kind: z.literal("failed"), code: z.string().min(1).max(120) }),
  ]),
  headerFrom: shortText,
  replyToAddress: mailAddress.nullable(),
  headerTo: z.array(shortText).max(100),
  headerCc: z.array(shortText).max(100),
  rfcMessageId: shortText.nullable(),
  inReplyTo: shortText.nullable(),
  references: z.array(shortText).max(20),
  subject: z.string().max(998),
  snippet: z.string().max(280),
  occurredAt: z.number().int().positive(),
  bodies: z.array(body).max(1),
  attachments: z.array(attachment).max(200),
});

export const completeIngressResponse = z.object({
  kind: z.enum(["committed", "duplicate"]),
});

export type BeginIngressRequest = z.infer<typeof beginIngressRequest>;
export type CompleteIngressRequest = z.infer<typeof completeIngressRequest>;

export function normalizeMailAddress(value: string) {
  const parsed = mailAddress.safeParse(value);
  if (!parsed.success) {
    throw new Error("Use a valid email address");
  }
  return parsed.data;
}
