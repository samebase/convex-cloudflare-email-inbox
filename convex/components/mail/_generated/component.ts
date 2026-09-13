/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> = {
  bootstrap: {
    ensureInboxes: FunctionReference<
      "mutation",
      "internal",
      {
        domain: string;
        inboxes: Array<{ label: string; localPart: string }>;
      },
      Array<string>,
      Name
    >;
  };
  delivery: {
    claim: FunctionReference<
      "mutation",
      "internal",
      { messageId: string },
      null | {
        cc: Array<string>;
        from: string;
        inReplyTo: string | null;
        references: Array<string>;
        subject: string;
        text: string;
        to: Array<string>;
      },
      Name
    >;
    finish: FunctionReference<
      "mutation",
      "internal",
      {
        messageId: string;
        outcome:
          | { kind: "accepted"; providerMessageId: string }
          | { code: string; kind: "rejected" }
          | { kind: "unknown" };
      },
      null,
      Name
    >;
  };
  inboxes: {
    create: FunctionReference<
      "mutation",
      "internal",
      { domain: string; label: string; localPart: string },
      string,
      Name
    >;
    list: FunctionReference<
      "query",
      "internal",
      {},
      Array<{
        _id: string;
        address: string;
        label: string;
        localPart: string;
        unreadCount: number;
      }>,
      Name
    >;
  };
  ingress: {
    begin: FunctionReference<
      "mutation",
      "internal",
      {
        envelopeFrom: string;
        ingressKey: string;
        rawSize: number;
        receivedAt: number;
        recipient: string;
      },
      | { kind: "ingest"; rawR2Key: string }
      | { kind: "duplicate" }
      | { kind: "reject"; reason: "unknown" },
      Name
    >;
    complete: FunctionReference<
      "mutation",
      "internal",
      {
        attachments: Array<{
          byteSize: number;
          mimeType: string;
          ordinal: number;
          originalFilename: string;
          r2Key: string;
        }>;
        bodies: Array<{
          content: string;
          originalByteCount: number;
          truncated: boolean;
        }>;
        headerCc: Array<string>;
        headerFrom: string;
        headerTo: Array<string>;
        inReplyTo: string | null;
        ingressKey: string;
        occurredAt: number;
        parse: { kind: "parsed" } | { code: string; kind: "failed" };
        recipient: string;
        references: Array<string>;
        replyToAddress: string | null;
        rfcMessageId: string | null;
        snippet: string;
        subject: string;
      },
      { kind: "committed"; messageId: string } | { kind: "duplicate"; messageId: string },
      Name
    >;
  };
  mail: {
    getThread: FunctionReference<
      "query",
      "internal",
      { threadId: string },
      null | {
        _id: string;
        inboxAddress: string;
        inboxId: string;
        messageCount: number;
        subject: string;
      },
      Name
    >;
    listMessages: FunctionReference<
      "query",
      "internal",
      {
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        threadId: string;
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _id: string;
          attachments: Array<{
            _id: string;
            byteSize: number;
            filename: string;
            mimeType: string;
          }>;
          bodyText: string;
          bodyTruncated: boolean;
          cc: Array<string>;
          direction: "inbound" | "outbound";
          from: string;
          occurredAt: number;
          rawAvailable: boolean;
          references: Array<string>;
          replyTo: string | null;
          rfcMessageId: string | null;
          status:
            | "received"
            | "queued"
            | "sending"
            | "accepted"
            | "rejected"
            | "unknown"
            | "parse_failed";
          subject: string;
          to: Array<string>;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      },
      Name
    >;
    listThreads: FunctionReference<
      "query",
      "internal",
      {
        inboxId: string | null;
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      {
        continueCursor: string;
        isDone: boolean;
        page: Array<{
          _id: string;
          inboxAddress: string;
          inboxId: string;
          lastActivityAt: number;
          lastFrom: string;
          messageCount: number;
          snippet: string;
          subject: string;
          unreadCount: number;
        }>;
        pageStatus?: "SplitRecommended" | "SplitRequired" | null;
        splitCursor?: string | null;
      },
      Name
    >;
    markThreadRead: FunctionReference<"mutation", "internal", { threadId: string }, null, Name>;
    queueSend: FunctionReference<
      "mutation",
      "internal",
      {
        cc: Array<string>;
        clientRequestId: string;
        inReplyTo: string | null;
        inboxId: string;
        references: Array<string>;
        subject: string;
        text: string;
        threadId: string | null;
        to: Array<string>;
      },
      string,
      Name
    >;
  };
  objects: {
    resolve: FunctionReference<
      "query",
      "internal",
      {
        object: { kind: "raw"; messageId: string } | { attachmentId: string; kind: "attachment" };
      },
      null | { contentType: string; filename: string; r2Key: string },
      Name
    >;
  };
};
