import { db } from "@emergency-trial/db";
import * as schema from "@emergency-trial/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  appName: "Emergency Trial",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    process.env.APP_ORIGIN ?? "http://localhost:3000",
    "http://localhost:3000",
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
  },
  user: {
    additionalFields: {
      mustChangePassword: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  advanced: {
    useSecureCookies:
      (process.env.APP_ORIGIN ?? "").startsWith("https://"),
    cookiePrefix: "emergency_trial",
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    nextCookies(),
  ],
});

export type AppSession = typeof auth.$Infer.Session;
