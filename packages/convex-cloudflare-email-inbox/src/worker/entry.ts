// The entry of the Worker that the package ships as dist/worker.bundle.js.
// EmailInbox from "./alchemy" uploads that bundle when the caller passes no
// Worker of its own. It serves the handlers of "./worker" and nothing else.
import { downloadObject, receiveEmail } from "./index.js";

type Environment = Parameters<typeof receiveEmail>[1] & Parameters<typeof downloadObject>[1];

export default {
  async email(message: Parameters<typeof receiveEmail>[0], env: Environment) {
    try {
      await receiveEmail(message, env);
    } catch {
      message.setReject("Mail storage is temporarily unavailable");
    }
  },
  async fetch(request: Request, env: Environment) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/mail/object") {
      return await downloadObject(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
