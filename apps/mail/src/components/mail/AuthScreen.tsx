import { useAuthActions } from "@convex-dev/auth/react";
import { Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";

export function AuthScreen() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) {
      return;
    }
    setError("");
    setIsPending(true);
    try {
      await signIn("password", {
        email,
        password,
        flow: mode,
        ...(mode === "signUp" ? { setupCode } : {}),
      });
    } catch (signInError: unknown) {
      setError(signInError instanceof Error ? signInError.message : "Could not sign in");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/35 p-5">
      <section className="w-full max-w-sm border bg-background p-6">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-9 place-items-center bg-primary text-primary-foreground">
            <Mail className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-medium">Mail</h1>
            <p className="text-sm text-muted-foreground">Private inboxes for your domains</p>
          </div>
        </div>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5 text-sm">
            Email
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Password
            <Input
              type="password"
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              minLength={12}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mode === "signUp" ? (
            <label className="flex flex-col gap-1.5 text-sm">
              One-time setup code
              <Input
                type="password"
                autoComplete="one-time-code"
                required
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
              />
            </label>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Working" : mode === "signIn" ? "Sign in" : "Create owner account"}
          </Button>
        </form>

        <Button
          type="button"
          variant="link"
          className="mt-3 h-auto px-0 text-muted-foreground"
          onClick={() => {
            setMode(mode === "signIn" ? "signUp" : "signIn");
            setError("");
          }}
        >
          {mode === "signIn" ? "First setup" : "I already have an account"}
        </Button>
      </section>
    </main>
  );
}
