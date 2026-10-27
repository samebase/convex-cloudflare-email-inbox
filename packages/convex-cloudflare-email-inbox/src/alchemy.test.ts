import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Output from "alchemy/Output";
import { RandomProvider } from "alchemy/Random";
import { Stack, type StackSpec } from "alchemy/Stack";
import { inMemoryState } from "alchemy/State/InMemoryState";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import { EmailInbox } from "./alchemy.js";

async function construct(destroyApp = false) {
  const stack: Omit<StackSpec<unknown>, "output"> = {
    name: "SamebaseMail",
    stage: "prod",
    resources: {},
    bindings: {},
    actions: {},
  };
  const inbox = await Effect.runPromise(
    EmailInbox("Mail", {
      convexSiteUrl: "https://mail-example.convex.site",
      zone: "example.com",
      sendingDomain: "example.com",
    }).pipe(
      Effect.provideService(Stack, stack),
      Effect.provideService(Cloudflare.Providers, {
        kind: "ProviderCollection",
        providers: {},
        get: () => undefined,
      }),
      Effect.provide(RandomProvider()),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DESTROY_APP: destroyApp }))),
    ),
  );
  const outputs = {
    [inbox.worker.FQN]: {
      url: "https://mail.example.workers.dev",
      workerName: "samebase-mail-inbox",
      accountId: "account-example",
    },
    [inbox.bridgeSecret.FQN]: { text: Redacted.make("bridge-secret-fixture") },
    [inbox.routing.FQN]: { zoneId: "zone-example" },
    [inbox.sendingToken.FQN]: {
      value: Redacted.make("sending-token-fixture"),
      accountId: "account-example",
    },
  };
  return { inbox, stack, outputs };
}

describe("EmailInbox provisioning", () => {
  it("preserves existing cloud identities and keeps stored mail by default", async () => {
    const { inbox, stack } = await construct();
    expect(
      Object.values(stack.resources)
        .sort((left, right) => left.FQN.localeCompare(right.FQN, "en"))
        .map((resource) => [resource.FQN, resource.Type, resource.RemovalPolicy]),
    ).toEqual([
      ["Mail/BridgeSecret", "Alchemy.Random", "destroy"],
      ["Mail/Inbox", "Cloudflare.Worker", "retain"],
      ["Mail/Inbox/EmailCatchAll", "Cloudflare.Email.CatchAll", "retain"],
      ["Mail/Inbox/EmailRouting", "Cloudflare.Email.Routing", "retain"],
      ["Mail/SendingDomain", "Cloudflare.Email.SendingSubdomain", "retain"],
      ["Mail/SendingToken", "Cloudflare.ApiToken.AccountApiToken", "destroy"],
      ["Mail/Storage", "Cloudflare.R2.Bucket", "retain"],
    ]);
    expect(inbox.sendingDomain.Adopt).toBeUndefined();
  });

  it("connects the Worker, sending credentials, and component environment through native outputs", async () => {
    const { inbox, stack, outputs } = await construct();
    const values = await Effect.runPromise(
      Output.evaluate(
        {
          env: inbox.env,
          worker: inbox.worker.Props,
          sendingDomain: inbox.sendingDomain.Props,
          sendingToken: inbox.sendingToken.Props,
          catchAll: stack.resources["Mail/Inbox/EmailCatchAll"]?.Props,
        },
        outputs,
      ).pipe(Effect.provide(inMemoryState())),
    );
    expect(values.env.MAIL_BRIDGE_SECRET).toBe(values.worker.env?.MAIL_BRIDGE_SECRET);
    expect(Redacted.value(values.env.MAIL_BRIDGE_SECRET)).toBe("bridge-secret-fixture");
    expect(Redacted.value(values.env.CLOUDFLARE_EMAIL_API_TOKEN)).toBe("sending-token-fixture");
    expect(values.env.CLOUDFLARE_EMAIL_ACCOUNT_ID).toBe("account-example");
    expect(values.env.MAIL_WORKER_URL).toBe("https://mail.example.workers.dev");
    expect(values.worker.env?.CONVEX_SITE_URL).toBe("https://mail-example.convex.site");
    expect(values.sendingDomain).toEqual({ zoneId: "zone-example", name: "example.com" });
    expect(values.sendingToken).toEqual({
      accountId: "account-example",
      policies: [
        {
          effect: "allow",
          permissionGroups: ["Email Sending Write"],
          resources: { "com.cloudflare.api.account.account-example": "*" },
        },
      ],
    });
    expect(values.catchAll).toEqual({
      zone: "zone-example",
      name: "Inbox",
      enabled: true,
      actions: [{ type: "worker", value: ["samebase-mail-inbox"] }],
    });
  });

  it("keeps shared zone services when an app opts into destroying its resources", async () => {
    const { stack } = await construct(true);
    expect(stack.resources["Mail/Storage"]?.RemovalPolicy).toBe("destroy");
    expect(stack.resources["Mail/Inbox"]?.RemovalPolicy).toBe("destroy");
    expect(stack.resources["Mail/Inbox/EmailCatchAll"]?.RemovalPolicy).toBe("destroy");
    expect(stack.resources["Mail/SendingToken"]?.RemovalPolicy).toBe("destroy");
    expect(stack.resources["Mail/Inbox/EmailRouting"]?.RemovalPolicy).toBe("retain");
    expect(stack.resources["Mail/SendingDomain"]?.RemovalPolicy).toBe("retain");
  });
});
