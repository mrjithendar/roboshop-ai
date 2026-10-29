import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, captcha, haveIBeenPwned } from "better-auth/plugins";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { createAccessControl } from "better-auth/plugins/access";
import { isProductionEnv, siteUrl } from "@/config/site";
import { getDb, schema } from "@/db";
import { sendMail } from "./mail";
import { socialProviderConfig } from "./auth-providers";
import { getSettings } from "./settings";
import { passwordProblem, PASSWORD_MAX, PASSWORD_MIN } from "./password-policy";
import { getRedis } from "./redis";
import { turnstileSecret } from "./turnstile";

export const ROLES = ["admin", "author", "user"] as const;
export type Role = (typeof ROLES)[number];

const INCREMENT_WITH_TTL = "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return c";

/** Endpoints that set a password, and the body field that holds it. */
const PASSWORD_ENDPOINTS: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/admin/set-user-password": "newPassword",
  "/admin/create-user": "password",
};

/** Self-service sign-up paths: whoever arrives here gets the lowest role, whatever the request says. */
export function isSelfRegistration(path: string | undefined): boolean {
  return path === "/sign-up/email" || path === "/sign-in/social" || (path?.startsWith("/callback/") ?? false);
}

/** Changing connected accounts needs a session younger than this (seconds); older sessions sign in again first. */
export const FRESH_SESSION_SECONDS = 60 * 60;

const ac = createAccessControl(defaultStatements);
const roles = { admin: adminAc, author: userAc, user: userAc };

async function createAuth() {
  const db = await getDb();
  const redis = await getRedis();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && isProductionEnv()) throw new Error("BETTER_AUTH_SECRET is required in production.");

  return betterAuth({
    appName: "Jithendar.com",
    baseURL: siteUrl(),
    secret: secret ?? "development-only-secret-not-for-production-use-000",
    trustedOrigins: [siteUrl()],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Sessions and rate-limit counters in Redis when available (shared by all replicas); Postgres otherwise.
    secondaryStorage: redis
      ? {
          get: (key) => redis.get(`auth:${key}`),
          getAndDelete: (key) => redis.getdel(`auth:${key}`),
          // INCR and set the TTL on creation in one atomic script (no counter can be left without expiry).
          increment: async (key, ttl) =>
            Number(await redis.eval(INCREMENT_WITH_TTL, 1, `auth:${key}`, String(ttl))),
          set: async (key, value, ttl) => {
            if (ttl) await redis.set(`auth:${key}`, value, "EX", ttl);
            else await redis.set(`auth:${key}`, value);
          },
          delete: async (key) => {
            await redis.del(`auth:${key}`);
          },
        }
      : undefined,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      autoSignIn: true,
      requireEmailVerification: false,
      // Sends through Amazon SES (admin-configured) or SMTP; if neither is set up, reset emails are skipped.
      sendResetPassword: async ({ user, url }) => {
        await sendMail(user.email, "Reset your Jithendar.com password", `Reset your password: ${url}\n\nIf you did not ask for this, ignore this email.`);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail(user.email, "Verify your Jithendar.com account", `Confirm your email address: ${url}`);
      },
    },
    // Google and GitHub (only those with credentials configured). Callback: {SITE_URL}/api/auth/callback/{provider}.
    socialProviders: socialProviderConfig(),
    account: {
      // Provider access/refresh tokens are not used by the site; keep them encrypted at rest anyway.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Never link an OAuth identity to an existing user just because the email matches: linking is only
        // the explicit, signed-in "Connect" flow on /account/settings, which proves control of both accounts.
        disableImplicitLinking: true,
        // The explicit flow already proves control, so a GitHub address may differ from the Google one.
        allowDifferentEmails: true,
        // The last way to sign in can never be removed.
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
    // OAuth callback failures land on the sign-in page with ?error=<code> (see lib/auth-errors.ts).
    onAPIError: { errorURL: "/login" },
    // 7-day sessions, extended daily while in use; account-linking changes need a sign-in within the last hour.
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: FRESH_SESSION_SECONDS },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (!isSelfRegistration(ctx?.path)) return;
            // Social sign-up follows the same switch as email sign-up.
            if (ctx?.path !== "/sign-up/email" && !(await getSettings()).features.registration) {
              throw new APIError("FORBIDDEN", { message: "Registration is currently closed.", code: "REGISTRATION_CLOSED" });
            }
            // Self-registered accounts are always readers; staff roles are granted only by an admin (or /setup).
            return { data: { ...user, role: "user", banned: false } };
          },
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: redis ? "secondary-storage" : "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/sign-in/social": { window: 60, max: 10 },
        "/callback/*": { window: 60, max: 20 },
        "/link-social": { window: 600, max: 10 },
        "/unlink-account": { window: 600, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: isProductionEnv(),
      // Callback/redirect URLs must be same-site (trustedOrigins). Explicit so tests run with the check on too
      // (Better Auth turns it off by default under NODE_ENV=test).
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },
    hooks: {
      // Public sign-up can be switched off from the admin settings.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && !(await getSettings()).features.registration) {
          throw new APIError("FORBIDDEN", { message: "Registration is currently closed." });
        }
        // Profile edits go through /account (server-validated, allowlisted fields), not the generic endpoint.
        if (ctx.path === "/update-user") {
          throw new APIError("FORBIDDEN", { message: "Edit your profile from the account page.", code: "USE_ACCOUNT_PAGE" });
        }
        // Connecting a provider requires a recent sign-in, like disconnecting one (Better Auth's fresh-session rule).
        if (ctx.path === "/link-social") {
          const current = await getSessionFromCtx(ctx);
          if (!current) throw new APIError("UNAUTHORIZED", { message: "Sign in first.", code: "UNAUTHORIZED" });
          if (Date.now() - new Date(current.session.createdAt).getTime() >= FRESH_SESSION_SECONDS * 1000) {
            throw new APIError("FORBIDDEN", { message: "Sign in again to connect an account.", code: "SESSION_NOT_FRESH" });
          }
        }
        // Password composition rule on every endpoint that sets a password.
        const body = (ctx.body ?? {}) as { password?: unknown; newPassword?: unknown };
        const candidate = PASSWORD_ENDPOINTS[ctx.path] === "newPassword" ? body.newPassword : PASSWORD_ENDPOINTS[ctx.path] ? body.password : undefined;
        if (typeof candidate === "string") {
          const problem = passwordProblem(candidate);
          if (problem) throw new APIError("BAD_REQUEST", { message: problem });
        }
      }),
    },
    plugins: [
      captcha({ provider: "cloudflare-turnstile", secretKey: turnstileSecret() ?? "missing-turnstile-secret" }),
      haveIBeenPwned(),
      admin({ ac, roles, defaultRole: "user", adminRoles: ["admin"] }),
      nextCookies(),
    ],
  });
}

type Auth = Awaited<ReturnType<typeof createAuth>>;
const globalForAuth = globalThis as unknown as { __auth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  globalForAuth.__auth ??= createAuth();
  return globalForAuth.__auth;
}
