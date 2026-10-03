import { useAuthActions } from "@convex-dev/auth/react";
import { usePaginatedQuery } from "convex-helpers/react";
import type { FunctionReturnType } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, Inbox, LogOut, MailPlus, Plus, Send } from "lucide-react";
import { EmailMessage, EmailMonitor } from "@samebase/convex-cloudflare-email-inbox-ui";
import "@samebase/convex-cloudflare-email-inbox-ui/styles.css";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Textarea } from "#components/ui/textarea";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type InboxSummary = FunctionReturnType<typeof api.inboxes.list>[number];
type ThreadSummary = FunctionReturnType<typeof api.mail.listThreads>["page"][number];
type ThreadDetail = NonNullable<FunctionReturnType<typeof api.mail.getThread>>;
type MessageView = FunctionReturnType<typeof api.mail.listMessages>["page"][number];
type InboxId = InboxSummary["_id"];
type ThreadId = ThreadSummary["_id"];
type ComposeTarget = { kind: "new" } | { kind: "reply"; threadId: ThreadId } | null;

export function MailWorkspace() {
  const { signOut } = useAuthActions();
  const inboxes = useQuery(api.inboxes.list, {});
  const [selectedInboxId, setSelectedInboxId] = useState<InboxId | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<ThreadId | null>(null);
  const [composeTarget, setComposeTarget] = useState<ComposeTarget>(null);
  const [mobilePane, setMobilePane] = useState<"inboxes" | "threads" | "message">("inboxes");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [view, setView] = useState<"inbox" | "history">("inbox");

  const {
    results: threads,
    status: threadStatus,
    loadMore: loadMoreThreads,
  } = usePaginatedQuery(
    api.mail.listThreads,
    { inboxId: selectedInboxId },
    { initialNumItems: 50 },
  );
  const thread = useQuery(
    api.mail.getThread,
    selectedThreadId ? { threadId: selectedThreadId } : "skip",
  );
  const {
    results: messages,
    status: messageStatus,
    loadMore: loadMoreMessages,
  } = usePaginatedQuery(
    api.mail.listMessages,
    selectedThreadId ? { threadId: selectedThreadId } : "skip",
    { initialNumItems: 10 },
  );
  const markThreadRead = useMutation(api.mail.markThreadRead);

  const activeInboxes = inboxes ?? [];
  const composeInbox =
    activeInboxes.find((inbox) => inbox._id === (thread?.inboxId ?? selectedInboxId)) ??
    activeInboxes[0];

  const openThread = (threadId: ThreadId) => {
    setSelectedThreadId(threadId);
    setComposeTarget(null);
    setMobilePane("message");
    void markThreadRead({ threadId });
  };

  const beginNewMessage = () => {
    if (!composeInbox) {
      return;
    }
    setComposeTarget({ kind: "new" });
    setView("inbox");
    setMobilePane("message");
  };

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2 font-medium">
          <span className="grid size-7 place-items-center bg-primary text-primary-foreground">
            <Inbox className="size-3.5" aria-hidden="true" />
          </span>
          Mail
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setView(view === "inbox" ? "history" : "inbox")}
          >
            {view === "inbox" ? "Email history" : "Inboxes"}
          </Button>
          <Button type="button" size="sm" disabled={!composeInbox} onClick={beginNewMessage}>
            <MailPlus aria-hidden="true" />
            New message
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={isSigningOut}
            aria-label="Sign out"
            onClick={() => {
              setIsSigningOut(true);
              void signOut().finally(() => setIsSigningOut(false));
            }}
          >
            <LogOut aria-hidden="true" />
          </Button>
        </div>
      </header>

      {view === "history" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <EmailMonitor api={api.emailMonitor} authorizeDownload={api.objects.authorizeDownload} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[14rem_22rem_minmax(0,1fr)]">
          <InboxPane
            className={mobilePane === "inboxes" ? "flex" : "hidden md:flex"}
            inboxes={inboxes ?? []}
            selectedInboxId={selectedInboxId}
            onSelect={(inboxId) => {
              setSelectedInboxId(inboxId);
              setSelectedThreadId(null);
              setComposeTarget(null);
              setMobilePane("threads");
            }}
          />
          <ThreadPane
            className={mobilePane === "threads" ? "flex" : "hidden md:flex"}
            threads={threads ?? []}
            selectedThreadId={selectedThreadId}
            canLoadMore={threadStatus === "CanLoadMore" || threadStatus === "LoadingMore"}
            isLoading={threadStatus === "LoadingFirstPage" || threadStatus === "LoadingMore"}
            onBack={() => setMobilePane("inboxes")}
            onLoadMore={() => loadMoreThreads(50)}
            onSelect={openThread}
          />
          <section
            className={`${mobilePane === "message" ? "flex" : "hidden md:flex"} min-h-0 flex-col bg-background`}
          >
            <div className="flex h-11 shrink-0 items-center border-b px-3 md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMobilePane("threads")}
              >
                <ArrowLeft aria-hidden="true" />
                Threads
              </Button>
            </div>
            {composeTarget && composeInbox ? (
              <ComposePane
                key={`${composeInbox._id}-${composeTarget.kind === "reply" ? composeTarget.threadId : "new"}`}
                inboxId={composeInbox._id}
                inboxAddress={composeInbox.address}
                thread={composeTarget.kind === "reply" ? thread : null}
                latestMessage={composeTarget.kind === "reply" ? messages[0] : undefined}
                onCancel={() => setComposeTarget(null)}
                onSent={() => setComposeTarget(null)}
              />
            ) : thread ? (
              <MessagePane
                thread={thread}
                messages={messages}
                canLoadMore={messageStatus === "CanLoadMore" || messageStatus === "LoadingMore"}
                canReply={Boolean(messages[0]?.replyRecipient)}
                isLoadingMore={messageStatus === "LoadingMore"}
                onLoadMore={() => loadMoreMessages(10)}
                onReply={() => setComposeTarget({ kind: "reply", threadId: thread._id })}
              />
            ) : (
              <EmptyReadingPane hasInboxes={activeInboxes.length > 0} />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function InboxPane({
  className,
  inboxes,
  selectedInboxId,
  onSelect,
}: {
  className: string;
  inboxes: InboxSummary[];
  selectedInboxId: InboxId | null;
  onSelect: (inboxId: InboxId | null) => void;
}) {
  const createInbox = useMutation(api.inboxes.create);
  const [isAdding, setIsAdding] = useState(false);
  const [localPart, setLocalPart] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = localPart.trim();
    if (!value || isPending) {
      return;
    }
    setError("");
    setIsPending(true);
    try {
      const inboxId = await createInbox({ domain: "json.md", localPart: value, label: value });
      setLocalPart("");
      setIsAdding(false);
      onSelect(inboxId);
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : "Could not create inbox");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <aside className={`${className} min-h-0 flex-col border-r bg-muted/30`}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Inboxes
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Add inbox"
          onClick={() => setIsAdding(!isAdding)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          type="button"
          className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm ${selectedInboxId === null ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"}`}
          onClick={() => onSelect(null)}
        >
          All mail
          <span>{inboxes.reduce((sum, inbox) => sum + inbox.unreadCount, 0) || ""}</span>
        </button>
        {inboxes.map((inbox) => (
          <button
            type="button"
            key={inbox._id}
            className={`mt-0.5 flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm ${selectedInboxId === inbox._id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60"}`}
            onClick={() => onSelect(inbox._id)}
          >
            <span className="min-w-0 truncate">{inbox.label}</span>
            {inbox.unreadCount ? <span>{inbox.unreadCount}</span> : null}
          </button>
        ))}
        {isAdding ? (
          <form className="mt-3 border-t pt-3" onSubmit={onSubmit}>
            <label className="text-xs text-muted-foreground" htmlFor="new-inbox">
              New json.md address
            </label>
            <div className="mt-1.5 flex items-center gap-1">
              <Input
                id="new-inbox"
                autoFocus
                placeholder="receipts"
                value={localPart}
                onChange={(event) => setLocalPart(event.target.value)}
              />
              <Button type="submit" size="icon-sm" disabled={!localPart.trim() || isPending}>
                <Plus aria-label="Create inbox" />
              </Button>
            </div>
            {error ? (
              <p className="mt-1.5 text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </aside>
  );
}

function ThreadPane({
  className,
  threads,
  selectedThreadId,
  canLoadMore,
  isLoading,
  onBack,
  onLoadMore,
  onSelect,
}: {
  className: string;
  threads: ThreadSummary[];
  selectedThreadId: ThreadId | null;
  canLoadMore: boolean;
  isLoading: boolean;
  onBack: () => void;
  onLoadMore: () => void;
  onSelect: (threadId: ThreadId) => void;
}) {
  return (
    <section className={`${className} min-h-0 flex-col border-r`}>
      <div className="flex h-11 shrink-0 items-center border-b px-2">
        <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack}>
          <ArrowLeft aria-label="Inboxes" />
        </Button>
        <span className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Threads
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {threads.length === 0 && !isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          threads.map((thread) => (
            <button
              type="button"
              key={thread._id}
              className={`w-full border-b px-4 py-3 text-left ${selectedThreadId === thread._id ? "bg-accent" : "hover:bg-muted/50"}`}
              onClick={() => onSelect(thread._id)}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span
                  className={`truncate text-sm ${thread.unreadCount ? "font-semibold" : "font-medium"}`}
                >
                  {thread.lastFrom}
                </span>
                <time className="shrink-0 text-[11px] text-muted-foreground">
                  {dateFormatter.format(thread.lastActivityAt)}
                </time>
              </div>
              <p className={`truncate text-sm ${thread.unreadCount ? "font-medium" : ""}`}>
                {thread.subject}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{thread.snippet}</p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="bg-muted px-1.5 py-0.5">to {thread.inboxAddress}</span>
                {thread.messageCount > 1 ? <span>{thread.messageCount} messages</span> : null}
              </div>
            </button>
          ))
        )}
        {canLoadMore ? (
          <div className="p-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              disabled={isLoading}
              onClick={onLoadMore}
            >
              {isLoading ? "Loading" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function MessagePane({
  thread,
  messages,
  canLoadMore,
  canReply,
  isLoadingMore,
  onLoadMore,
  onReply,
}: {
  thread: ThreadDetail;
  messages: MessageView[];
  canLoadMore: boolean;
  canReply: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onReply: () => void;
}) {
  const authorizeDownload = useAction(api.objects.authorizeDownload);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-medium">{thread.subject}</h1>
          <p className="text-xs text-muted-foreground">{thread.inboxAddress}</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!canReply} onClick={onReply}>
          Reply
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {canLoadMore ? (
          <div className="border-b p-3 text-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isLoadingMore}
              onClick={onLoadMore}
            >
              {isLoadingMore ? "Loading" : "Load older messages"}
            </Button>
          </div>
        ) : null}
        {messages.toReversed().map((message) => (
          <div key={message._id} className="border-b px-5 py-5 last:border-b-0">
            <EmailMessage
              message={message}
              onDownload={(object) => authorizeDownload({ object })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ComposePane({
  inboxId,
  inboxAddress,
  thread,
  latestMessage,
  onCancel,
  onSent,
}: {
  inboxId: InboxId;
  inboxAddress: string;
  thread: ThreadDetail | null | undefined;
  latestMessage: MessageView | undefined;
  onCancel: () => void;
  onSent: () => void;
}) {
  const queueSend = useMutation(api.mail.queueSend);
  const queueReply = useMutation(api.mail.reply);
  const [to, setTo] = useState(latestMessage?.replyRecipient ?? "");
  const [subject, setSubject] = useState(
    thread
      ? thread.subject.toLowerCase().startsWith("re:")
        ? thread.subject
        : `Re: ${thread.subject}`
      : "",
  );
  const [body, setBody] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const recipients = to
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (recipients.length === 0 || !body.trim() || isPending) {
      return;
    }
    setError("");
    setIsPending(true);
    try {
      const content = {
        idempotencyKey,
        to: recipients,
        cc: [],
        subject,
        text: body,
      };
      if (latestMessage) {
        await queueReply({ ...content, messageId: latestMessage._id });
      } else {
        await queueSend({ ...content, inboxId });
      }
      onSent();
    } catch (sendError: unknown) {
      setError(sendError instanceof Error ? sendError.message : "Could not send message");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <div className="border-b px-5 py-3">
        <h1 className="font-medium">{thread ? "Reply" : "New message"}</h1>
        <p className="text-xs text-muted-foreground">From {inboxAddress}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <label className="flex flex-col gap-1.5 text-sm">
          To
          <Input
            type="text"
            inputMode="email"
            placeholder="name@example.com"
            required
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Subject
          <Input
            required
            maxLength={998}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-sm">
          Message
          <Textarea
            className="min-h-52 flex-1 resize-none"
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!to.trim() || !body.trim() || isPending}>
          <Send aria-hidden="true" />
          {isPending ? "Sending" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function EmptyReadingPane({ hasInboxes }: { hasInboxes: boolean }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
      {hasInboxes ? "Select a thread or start a new message." : "Create an inbox to start."}
    </div>
  );
}
