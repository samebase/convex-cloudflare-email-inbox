/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as bootstrap from "../bootstrap.js";
import type * as emailMonitor from "../emailMonitor.js";
import type * as http from "../http.js";
import type * as inboxes from "../inboxes.js";
import type * as mail from "../mail.js";
import type * as objects from "../objects.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  bootstrap: typeof bootstrap;
  emailMonitor: typeof emailMonitor;
  http: typeof http;
  inboxes: typeof inboxes;
  mail: typeof mail;
  objects: typeof objects;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  mail: import("@samebase/convex-cloudflare-email-inbox/_generated/component.js").ComponentApi<"mail">;
};
