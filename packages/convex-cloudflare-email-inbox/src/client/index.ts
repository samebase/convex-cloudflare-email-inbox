import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  PaginationOptions,
} from "convex/server";
import type { Infer } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import { normalizeMailAddress } from "../component/mailProtocol.js";

import { replyOptions, sendOptions } from "../component/messageTypes.js";

export { replyOptions, sendOptions };
export type SendOptions = Infer<typeof sendOptions>;
export type ReplyOptions = Infer<typeof replyOptions>;
export type EmailInboxOptions = {
  defaultInbox?: { address: string; label: string; senderName?: string };
};

type MutationRunner = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
type QueryRunner = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type QueueContext = Pick<GenericMutationCtx<GenericDataModel>, "runMutation" | "scheduler">;

/** Server-side client. Application wrappers must authorize every operation. */
export class EmailInbox {
  constructor(
    private readonly component: ComponentApi,
    private readonly options: EmailInboxOptions = {},
  ) {}

  private async queue(ctx: MutationRunner, options: SendOptions) {
    let inboxId = options.inboxId;
    const defaultInbox = this.options.defaultInbox;
    const requestedFrom = typeof options.from === "string" ? options.from : options.from?.address;
    const from = requestedFrom === undefined ? undefined : normalizeMailAddress(requestedFrom);
    if (!inboxId && !from) {
      if (!defaultInbox) throw new Error("A from address, inboxId, or defaultInbox is required");
      const address = normalizeMailAddress(defaultInbox.address);
      const separator = address.lastIndexOf("@");
      const ids = await ctx.runMutation(this.component.bootstrap.ensureInboxes, {
        domain: address.slice(separator + 1),
        inboxes: [{ localPart: address.slice(0, separator), label: defaultInbox.label }],
      });
      inboxId = ids[0];
      if (!inboxId) throw new Error("Could not create the default inbox");
    }
    const senderName =
      typeof options.from === "object"
        ? options.from.name
        : !options.inboxId && !from
          ? defaultInbox?.senderName
          : undefined;
    return await ctx.runMutation(this.component.mail.queueSend, {
      ...(inboxId ? { inboxId } : {}),
      ...(from === undefined ? {} : { from }),
      threadId: null,
      clientRequestId: options.idempotencyKey,
      to: options.to,
      cc: options.cc ?? [],
      bcc: options.bcc ?? [],
      subject: options.subject,
      text: options.text ?? "",
      ...(options.html === undefined ? {} : { html: options.html }),
      ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
      attachments: options.attachments ?? [],
      inReplyTo: null,
      references: [],
      ...(senderName !== undefined ? { senderName } : {}),
    });
  }

  /** Starts an attempt and returns current state. Confirmed throttling may return queued. */
  async send(
    ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation" | "runAction">,
    options: SendOptions,
  ) {
    const messageId = await this.queue(ctx, options);
    const delivery = await ctx.runAction(this.component.delivery.send, { messageId });
    return { messageId, ...delivery };
  }

  /** Queueing and scheduling participate in the caller's mutation transaction. */
  async enqueue(
    ctx: Pick<GenericMutationCtx<GenericDataModel>, "runMutation" | "scheduler">,
    options: SendOptions,
  ) {
    const messageId = await this.queue(ctx, options);
    await ctx.scheduler.runAfter(0, this.component.delivery.send, { messageId });
    return messageId;
  }

  /** Queues a reply. The component reads the parent and derives its RFC headers. */
  async reply(ctx: QueueContext, options: ReplyOptions) {
    const messageId = await ctx.runMutation(this.component.mail.queueReply, {
      messageId: options.messageId,
      idempotencyKey: options.idempotencyKey,
      ...(options.to === undefined ? {} : { to: options.to }),
      ...(options.subject === undefined ? {} : { subject: options.subject }),
      ...(options.text === undefined ? {} : { text: options.text }),
      ...(options.html === undefined ? {} : { html: options.html }),
      ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
      cc: options.cc ?? [],
      bcc: options.bcc ?? [],
      attachments: options.attachments ?? [],
    });
    await ctx.scheduler.runAfter(0, this.component.delivery.send, { messageId });
    return messageId;
  }

  async createInbox(ctx: MutationRunner, options: { address: string; label: string }) {
    const address = normalizeMailAddress(options.address);
    const separator = address.lastIndexOf("@");
    return await ctx.runMutation(this.component.inboxes.create, {
      domain: address.slice(separator + 1),
      localPart: address.slice(0, separator),
      label: options.label,
    });
  }

  async listInboxes(ctx: QueryRunner) {
    return await ctx.runQuery(this.component.inboxes.list, {});
  }

  async listThreads(
    ctx: QueryRunner,
    options: { inboxId?: string | null; paginationOpts: PaginationOptions },
  ) {
    return await ctx.runQuery(this.component.mail.listThreads, {
      inboxId: options.inboxId ?? null,
      paginationOpts: options.paginationOpts,
    });
  }

  async getThread(ctx: QueryRunner, options: { threadId: string }) {
    return await ctx.runQuery(this.component.mail.getThread, { threadId: options.threadId });
  }

  async listMessages(
    ctx: QueryRunner,
    options: { threadId: string; paginationOpts: PaginationOptions },
  ) {
    return await ctx.runQuery(this.component.mail.listMessages, {
      threadId: options.threadId,
      paginationOpts: options.paginationOpts,
    });
  }

  async getMessage(ctx: QueryRunner, options: { messageId: string }) {
    return await ctx.runQuery(this.component.mail.getMessage, { messageId: options.messageId });
  }

  async getDelivery(ctx: QueryRunner, options: { messageId: string }) {
    return await ctx.runQuery(this.component.delivery.get, { messageId: options.messageId });
  }

  async markThreadRead(ctx: MutationRunner, options: { threadId: string }) {
    return await ctx.runMutation(this.component.mail.markThreadRead, {
      threadId: options.threadId,
    });
  }
}
