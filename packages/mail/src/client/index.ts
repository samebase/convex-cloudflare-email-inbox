import type {
  FunctionArgs,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { normalizeMailAddress } from "../component/mailProtocol.js";

type QueueArgs = FunctionArgs<ComponentApi["mail"]["queueSend"]>;
export type SendOptions = Omit<
  QueueArgs,
  "inboxId" | "threadId" | "cc" | "inReplyTo" | "references"
> & {
  inboxId?: string;
  threadId?: string | null;
  cc?: string[];
  inReplyTo?: string | null;
  references?: string[];
};
export type EmailInboxOptions = {
  defaultInbox?: { address: string; label: string; senderName?: string };
};

type MutationRunner = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

export class EmailInbox {
  constructor(
    private readonly component: ComponentApi,
    private readonly options: EmailInboxOptions = {},
  ) {}

  private async queue(ctx: MutationRunner, options: SendOptions) {
    let inboxId = options.inboxId;
    const defaultInbox = this.options.defaultInbox;
    if (!inboxId) {
      if (!defaultInbox) throw new Error("An inboxId or defaultInbox is required");
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
      options.senderName ?? (!options.inboxId ? defaultInbox?.senderName : undefined);
    return await ctx.runMutation(this.component.mail.queueSend, {
      inboxId,
      threadId: options.threadId ?? null,
      clientRequestId: options.clientRequestId,
      to: options.to,
      cc: options.cc ?? [],
      subject: options.subject,
      text: options.text,
      inReplyTo: options.inReplyTo ?? null,
      references: options.references ?? [],
      ...(senderName !== undefined ? { senderName } : {}),
    });
  }

  async send(
    ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation" | "runAction">,
    options: SendOptions,
  ) {
    const messageId = await this.queue(ctx, options);
    const delivery = await ctx.runAction(this.component.delivery.send, { messageId });
    return { messageId, ...delivery };
  }

  async enqueue(
    ctx: Pick<GenericMutationCtx<GenericDataModel>, "runMutation" | "scheduler">,
    options: SendOptions,
  ) {
    const messageId = await this.queue(ctx, options);
    await ctx.scheduler.runAfter(0, this.component.delivery.send, { messageId });
    return messageId;
  }
}
