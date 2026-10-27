import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, captcha, haveIBeenPwned } from "better-auth/plugins";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { createAccessControl } from "better-auth/plugins/access";
import { isProductionEnv, siteUrl } from "@/config/site";
import { getDb, schema } from "@/db";
import { sendMail } from "./mail";
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
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: redis ? "secondary-storage" : "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: isProductionEnv(),
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },
    hooks: {
      // Public sign-up can be switched off from the admin settings.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && !(await getSettings()).features.registration) {
          throw new APIError("FORBIDDEN", { message: "Registration is currently closed." });
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
