import type { EmailSendingSendParams } from "cloudflare/resources/email-sending/email-sending";
import type { Infer } from "convex/values";
import { createObjectGrant } from "../r2";
import { MAX_OUTBOUND_BYTES, type sendPayload } from "./cloudflareEmail";

type PreparedAttachments =
  | { kind: "ready"; attachments: EmailSendingSendParams.EmailSendingEmailAttachment[] }
  | { kind: "rejected"; code: string };

export async function loadOutboundAttachments(
  payload: Infer<typeof sendPayload>,
  storage: { workerUrl: string | undefined; secret: string | undefined },
): Promise<PreparedAttachments> {
  const encodedBytes =
    new TextEncoder().encode(JSON.stringify(payload)).byteLength +
    payload.attachments.reduce(
      (total, attachment) => total + 4 * Math.ceil(attachment.byteSize / 3),
      0,
    );
  if (payload.attachments.length > 32 || encodedBytes > MAX_OUTBOUND_BYTES) {
    return { kind: "rejected", code: "message_too_large" };
  }
  if (!payload.attachments.length) return { kind: "ready", attachments: [] };
  if (!storage.workerUrl || !storage.secret) {
    return { kind: "rejected", code: "attachment_storage_not_configured" };
  }
  const attachments: EmailSendingSendParams.EmailSendingEmailAttachment[] = [];
  try {
    for (const attachment of payload.attachments) {
      if (
        !Number.isSafeInteger(attachment.byteSize) ||
        attachment.byteSize < 0 ||
        attachment.byteSize > MAX_OUTBOUND_BYTES ||
        !/^[a-f0-9]{64}$/.test(attachment.sha256)
      ) {
        return { kind: "rejected", code: "attachment_metadata_invalid" };
      }
      const grant = await createObjectGrant(
        {
          expiresAt: Date.now() + 5 * 60_000,
          r2Key: attachment.r2Key,
          filename: attachment.filename,
          contentType: attachment.contentType,
        },
        storage.secret,
      );
      const url = new URL("/api/mail/object", storage.workerUrl);
      url.searchParams.set("grant", grant);
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { kind: "rejected", code: "attachment_unavailable" };
      }
      const reader = response.body?.getReader();
      const bytes = new Uint8Array(attachment.byteSize);
      let offset = 0;
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (offset + chunk.value.byteLength > bytes.byteLength) {
              await reader.cancel();
              return { kind: "rejected", code: "attachment_size_mismatch" };
            }
            bytes.set(chunk.value, offset);
            offset += chunk.value.byteLength;
          }
        } finally {
          reader.releaseLock();
        }
      }
      if (offset !== attachment.byteSize) {
        return { kind: "rejected", code: "attachment_size_mismatch" };
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (sha256 !== attachment.sha256) {
        return { kind: "rejected", code: "attachment_digest_mismatch" };
      }
      let binary = "";
      for (let start = 0; start < bytes.byteLength; start += 8_192) {
        binary += String.fromCharCode(...bytes.subarray(start, start + 8_192));
      }
      attachments.push({
        content: btoa(binary),
        filename: attachment.filename,
        type: attachment.contentType,
        disposition: "attachment",
      });
    }
    return { kind: "ready", attachments };
  } catch {
    // No provider request has started, so a failed read is conclusively unsent.
    return { kind: "rejected", code: "attachment_unavailable" };
  }
}
