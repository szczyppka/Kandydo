import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET nie jest ustawione (sprawdź .env)");
}

// Google provider włącza się sam, gdy GOOGLE_CLIENT_ID/SECRET są ustawione
// (Google Cloud Console — patrz docs/architecture.md sekcja 11) — świadomie
// pominięte na razie, email/hasło działa już teraz.
const googleCredentials =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }
    : undefined;

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: googleCredentials
    ? { google: googleCredentials }
    : undefined,
});
