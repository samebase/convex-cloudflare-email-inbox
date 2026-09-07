import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

function requiredEnvironmentValue(name: "OWNER_EMAIL" | "OWNER_SETUP_SECRET") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const suppliedEmail = params["email"];
        const email = typeof suppliedEmail === "string" ? suppliedEmail.trim().toLowerCase() : "";
        const ownerEmail = requiredEnvironmentValue("OWNER_EMAIL").trim().toLowerCase();
        if (email !== ownerEmail) {
          throw new Error("This account is not allowed");
        }
        if (
          params["flow"] === "signUp" &&
          params["setupCode"] !== requiredEnvironmentValue("OWNER_SETUP_SECRET")
        ) {
          throw new Error("The setup code is not valid");
        }
        return { email };
      },
      validatePasswordRequirements(password) {
        if (password.length < 12) {
          throw new Error("Use at least 12 characters");
        }
      },
    }),
  ],
});
