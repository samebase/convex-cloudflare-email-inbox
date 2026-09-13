/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as bootstrap from "../bootstrap.js";
import type * as delivery from "../delivery.js";
import type * as inboxes from "../inboxes.js";
import type * as ingress from "../ingress.js";
import type * as mail from "../mail.js";
import type * as mailProtocol from "../mailProtocol.js";
import type * as objects from "../objects.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  bootstrap: typeof bootstrap;
  delivery: typeof delivery;
  inboxes: typeof inboxes;
  ingress: typeof ingress;
  mail: typeof mail;
  mailProtocol: typeof mailProtocol;
  objects: typeof objects;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
