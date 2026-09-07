import { createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { AuthScreen } from "#components/mail/AuthScreen";
import { MailWorkspace } from "#components/mail/MailWorkspace";
import { ConvexClientProvider } from "../lib/convex";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <ConvexClientProvider>
      <AuthLoading>
        <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
          Opening mail
        </main>
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        <MailWorkspace />
      </Authenticated>
    </ConvexClientProvider>
  );
}
