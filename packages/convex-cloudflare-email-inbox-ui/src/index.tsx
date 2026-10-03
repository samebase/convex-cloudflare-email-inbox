import type { EmailInbox } from "@samebase/convex-cloudflare-email-inbox";
import { usePaginatedQuery } from "convex-helpers/react";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback, useId, useRef, useState } from "react";

type Inboxes = Awaited<ReturnType<EmailInbox["listInboxes"]>>;
type History = Awaited<ReturnType<EmailInbox["listHistory"]>>;
type HistoryOptions = Parameters<EmailInbox["listHistory"]>[1];
export type Message = NonNullable<Awaited<ReturnType<EmailInbox["getMessage"]>>>;
export type Delivery = Awaited<ReturnType<EmailInbox["getDelivery"]>>;
export type DownloadObject =
  | { kind: "raw"; messageId: string }
  | { kind: "attachment"; attachmentId: string };

export type EmailMonitorApi = {
  listInboxes: FunctionReference<"query", "public", Record<string, never>, Inboxes>;
  listHistory: FunctionReference<"query", "public", HistoryOptions, History>;
  getMessage: FunctionReference<"query", "public", { messageId: string }, Message | null>;
  getDelivery: FunctionReference<"query", "public", { messageId: string }, Delivery>;
};

export type EmailMonitorProps = {
  api: EmailMonitorApi;
  authorizeDownload?: FunctionReference<"action", "public", { object: DownloadObject }, string>;
};

const statusLabels = {
  received: "Received",
  parse_failed: "Could not parse",
  queued: "Queued",
  sending: "Sending",
  accepted: "Accepted",
  rejected: "Rejected",
  unknown: "Unknown",
} satisfies Record<Message["status"], string>;

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

/** Mount inside the host's Convex provider. Every supplied endpoint must enforce access. */
export function EmailMonitor({ api, authorizeDownload }: EmailMonitorProps) {
  const id = useId();
  const convex = useConvex();
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [status, setStatus] = useState<Message["status"] | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const focusReader = useCallback((node: HTMLDivElement | null) => node?.focus(), []);
  const inboxes = useQuery(api.listInboxes, {});
  const history = usePaginatedQuery(api.listHistory, { inboxId, status }, { initialNumItems: 25 });
  const message = useQuery(api.getMessage, messageId ? { messageId } : "skip");
  const delivery = useQuery(
    api.getDelivery,
    message?.direction === "outbound" ? { messageId: message._id } : "skip",
  );

  return (
    <section className="sb-email" aria-label="Email monitor">
      <div className="sb-email-filters">
        <label htmlFor={`${id}-inbox`}>
          Inbox
          <select
            id={`${id}-inbox`}
            value={inboxId ?? ""}
            onChange={(event) => {
              setInboxId(event.target.value || null);
              setMessageId(null);
            }}
          >
            <option value="">All inboxes</option>
            {inboxes?.map((inbox) => (
              <option key={inbox._id} value={inbox._id}>
                {inbox.address}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-status`}>
          Status
          <select
            id={`${id}-status`}
            value={status ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              switch (value) {
                case "received":
                case "parse_failed":
                case "queued":
                case "sending":
                case "accepted":
                case "rejected":
                case "unknown":
                  setStatus(value);
                  break;
                default:
                  setStatus(null);
              }
              setMessageId(null);
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="sb-email-history"
        tabIndex={0}
        role="region"
        aria-label="Email history table"
        aria-busy={history.status === "LoadingFirstPage"}
      >
        <table>
          <caption className="sb-email-sr-only">Email history, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Message</th>
              <th scope="col">Recipient</th>
              <th scope="col">Inbox</th>
              <th scope="col">Status</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {history.results.map((item) => (
              <tr key={item._id} data-selected={item._id === messageId ? "true" : undefined}>
                <td>
                  <button
                    type="button"
                    className="sb-email-subject"
                    aria-pressed={item._id === messageId}
                    aria-controls={`${id}-reader`}
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setMessageId(item._id);
                    }}
                  >
                    {item.subject}
                  </button>
                  <span className="sb-email-secondary">{item.from}</span>
                </td>
                <td>{item.to.join(", ")}</td>
                <td>{item.inboxAddress}</td>
                <td>{statusLabels[item.status]}</td>
                <td>
                  <time dateTime={new Date(item.occurredAt).toISOString()}>
                    {dateLabel(item.occurredAt)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.results.length === 0 && history.status !== "LoadingFirstPage" ? (
          <p className="sb-email-empty">No emails match these filters.</p>
        ) : null}
      </div>
      {history.status === "CanLoadMore" || history.status === "LoadingMore" ? (
        <button
          type="button"
          className="sb-email-more"
          disabled={history.status === "LoadingMore"}
          onClick={() => history.loadMore(25)}
        >
          {history.status === "LoadingMore" ? "Loading" : "Load more"}
        </button>
      ) : null}
      <div id={`${id}-reader`} aria-busy={messageId !== null && message === undefined}>
        {message ? (
          <div
            key={message._id}
            ref={focusReader}
            tabIndex={-1}
            className="sb-email-reader"
            role="region"
            aria-label={message.subject}
          >
            <div className="sb-email-reader-heading">
              <h2>{message.subject}</h2>
              <button
                type="button"
                onClick={() => {
                  setMessageId(null);
                  opener.current?.focus();
                }}
              >
                Close message
              </button>
            </div>
            <EmailMessage
              key={message._id}
              message={message}
              delivery={delivery}
              onDownload={
                authorizeDownload
                  ? (object) => convex.action(authorizeDownload, { object })
                  : undefined
              }
            />
          </div>
        ) : message === null ? (
          <p className="sb-email-empty">Message not found.</p>
        ) : null}
      </div>
    </section>
  );
}

/** Plain-text reader shared with full inbox apps. HTML is never inserted into the document. */
export function EmailMessage({
  message,
  delivery,
  onDownload,
}: {
  message: Message;
  delivery?: Delivery | undefined;
  onDownload?: ((object: DownloadObject) => Promise<string>) | undefined;
}) {
  const [download, setDownload] = useState<
    { kind: "idle" } | { kind: "pending" } | { kind: "failed" }
  >({ kind: "idle" });
  const downloadObject = async (object: DownloadObject) => {
    if (!onDownload || download.kind === "pending") return;
    setDownload({ kind: "pending" });
    try {
      const url = new URL(await onDownload(object));
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("Invalid download URL");
      window.location.assign(url.href);
      setDownload({ kind: "idle" });
    } catch {
      setDownload({ kind: "failed" });
    }
  };

  return (
    <article className="sb-email sb-email-message">
      <dl className="sb-email-metadata">
        <div>
          <dt>From</dt>
          <dd>{message.from}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{message.to.join(", ")}</dd>
        </div>
        {message.cc.length ? (
          <div>
            <dt>Cc</dt>
            <dd>{message.cc.join(", ")}</dd>
          </div>
        ) : null}
        {message.bcc.length ? (
          <div>
            <dt>Bcc</dt>
            <dd>{message.bcc.join(", ")}</dd>
          </div>
        ) : null}
        <div>
          <dt>Date</dt>
          <dd>
            <time dateTime={new Date(message.occurredAt).toISOString()}>
              {dateLabel(message.occurredAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabels[delivery?.kind ?? message.status]}</dd>
        </div>
        {message.rfcMessageId ? (
          <div>
            <dt>Message ID</dt>
            <dd>{message.rfcMessageId}</dd>
          </div>
        ) : null}
      </dl>
      {delivery ? <DeliveryDetail delivery={delivery} /> : null}
      {message.status === "parse_failed" ? (
        <p>
          The message could not be parsed.
          {message.rawAvailable && onDownload ? " Download the raw message to inspect it." : null}
        </p>
      ) : null}
      <div className="sb-email-body">{message.bodyText || "No readable text body."}</div>
      {message.bodyTruncated ? (
        <p className="sb-email-secondary">The displayed body is truncated.</p>
      ) : null}
      {message.attachments.length ? (
        <ul className="sb-email-attachments" aria-label="Attachments">
          {message.attachments.map((attachment) => (
            <li key={attachment._id}>
              {onDownload ? (
                <button
                  type="button"
                  disabled={download.kind === "pending"}
                  onClick={() =>
                    void downloadObject({ kind: "attachment", attachmentId: attachment._id })
                  }
                >
                  {attachment.filename}
                </button>
              ) : (
                <span>{attachment.filename}</span>
              )}
              <span className="sb-email-secondary">
                {attachment.byteSize.toLocaleString()} bytes · {attachment.mimeType}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {message.rawAvailable && onDownload ? (
        <button
          type="button"
          disabled={download.kind === "pending"}
          onClick={() => void downloadObject({ kind: "raw", messageId: message._id })}
        >
          Download raw message
        </button>
      ) : null}
      {download.kind === "pending" ? <p role="status">Preparing download</p> : null}
      {download.kind === "failed" ? (
        <p role="alert">Could not download the file. Try again.</p>
      ) : null}
    </article>
  );
}

function DeliveryDetail({ delivery }: { delivery: Delivery }) {
  switch (delivery.kind) {
    case "accepted":
      return (
        <div className="sb-email-delivery">
          <p>
            Cloudflare accepted this message. Acceptance does not confirm delivery to every
            recipient.
          </p>
          {delivery.recipientResults ? (
            <dl className="sb-email-metadata">
              {delivery.recipientResults.delivered.length ? (
                <div>
                  <dt>Delivered</dt>
                  <dd>{delivery.recipientResults.delivered.join(", ")}</dd>
                </div>
              ) : null}
              {delivery.recipientResults.queued.length ? (
                <div>
                  <dt>Queued by Cloudflare</dt>
                  <dd>{delivery.recipientResults.queued.join(", ")}</dd>
                </div>
              ) : null}
              {delivery.recipientResults.permanent_bounces.length ? (
                <div>
                  <dt>Permanently bounced</dt>
                  <dd>{delivery.recipientResults.permanent_bounces.join(", ")}</dd>
                </div>
              ) : null}
              {delivery.recipientResults.suppressed_recipients?.length ? (
                <div>
                  <dt>Suppressed</dt>
                  <dd>{delivery.recipientResults.suppressed_recipients.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      );
    case "rejected":
      return (
        <p className="sb-email-delivery">Cloudflare rejected this message. Code: {delivery.code}</p>
      );
    case "unknown":
      return (
        <p className="sb-email-delivery">
          Delivery could not be confirmed. Check Cloudflare before sending again to avoid duplicate
          emails.
        </p>
      );
    case "queued":
      return (
        <p className="sb-email-delivery">
          Waiting to send
          {delivery.notBefore ? `, next attempt after ${dateLabel(delivery.notBefore)}` : ""}.
        </p>
      );
    case "sending":
      return (
        <p className="sb-email-delivery">Sending started at {dateLabel(delivery.startedAt)}.</p>
      );
    default:
      return delivery satisfies never;
  }
}
