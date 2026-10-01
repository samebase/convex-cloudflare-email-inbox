// Same shape as Convex codegen's component references for this isolated fixture.
import { componentsGeneric } from "convex/server";
import type { ComponentApi } from "@samebase/convex-cloudflare-email-inbox/_generated/component.js";
export const components = componentsGeneric() as unknown as { mail: ComponentApi<"mail"> };
