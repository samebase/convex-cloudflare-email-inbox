// Official HTTP 200 example, retrieved 2026-10-01:
// https://developers.cloudflare.com/api/resources/email_sending/methods/send/
export const cloudflareSendReceipt = {
  errors: [{ code: 0, message: "message" }],
  messages: [{ code: 0, message: "message" }],
  result: {
    delivered: ["recipient@example.com"],
    message_id: "<aB3xK9mP2qR5sT8uV0wX1yZ4cD6fG7hJ9kL0@example.com>",
    permanent_bounces: ["string"],
    queued: ["string"],
    suppressed_recipients: ["string"],
  },
  success: true,
  result_info: { count: 0, per_page: 0, total_count: 0, cursor: "cursor", page: 0 },
};

// Official invalid-schema response, retrieved 2026-10-01:
// https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
export const cloudflareSendRejection = {
  success: false,
  errors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }],
  messages: [],
  result: null,
};
