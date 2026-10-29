# Authentication, accounts and profiles

Sign-in is [Better Auth](https://www.better-auth.com) 1.7 (already used for email + password), extended with
Google and GitHub. Everything runs inside the site: no extra service.

**Status: requires manual configuration.** The code and tests are complete, but no Google or GitHub OAuth
client exists yet. Until both the ID and secret of a provider are set, its button is not shown and its
endpoints answer "provider not found".

## What exists

| Area | Behaviour | Code |
|---|---|---|
| Sign-in page | "Continue with Google / GitHub" (only for configured providers), email + password (Turnstile), loading states, readable errors, returns to `?next=` | `src/app/login/` |
| OAuth flow | Authorization code + PKCE (S256) + `state` for both; Google ID token checked against an OIDC nonce; scopes: Google `openid email profile`, GitHub `user:email` only | `src/lib/auth-providers.ts`, `src/lib/auth.ts` |
| Redirects | `next` and every callback URL must be same-site paths (`src/lib/safe-next.ts`); Better Auth's origin check rejects anything else (403) | |
| New users | Always role `user` (reader), whatever the request says; `role` in a sign-up body is rejected (`FIELD_NOT_ALLOWED`); social sign-up obeys Admin → Settings → Registration | `databaseHooks` in `src/lib/auth.ts` |
| Account linking | **Never automatic.** A Google/GitHub identity whose email matches an existing user is refused (`account_not_linked`) and the user is told to sign in the usual way and connect it from Account settings. Connecting is Better Auth's `linkSocial` while signed in, after a sign-in within the last hour | `account.accountLinking` in `src/lib/auth.ts` |
| Unlinking | Only your own accounts, only with a fresh session, never the last sign-in method | `src/app/account/actions.ts` |
| Profile | `/account`: display name, short bio, website, GitHub/LinkedIn/X links, avatar. Allowlisted fields, validated server-side (length, https URLs on the right hosts, no control/bidi characters), user id always from the session. Private by default | `src/lib/profile.ts` |
| Account settings | `/account/settings`: email (read-only), connected sign-in methods, sign out / sign out of all devices | |
| Header | Account control at the far right: "Sign in" when signed out; avatar (initials fallback) with a menu (name, email, My profile, Account settings, Dashboard for authors/admins, Sign out). Read from `/api/auth/get-session` in the browser, so cached public HTML never contains account data | `src/components/AccountMenu.tsx` |
| Avatars | Uploaded to R2 at `jithendar/www/media/images/avatars/{user-id}/{uuid}.webp`, served from `/media/avatars/{user-id}/{uuid}.webp` (only the current one) | `src/lib/avatar.ts` |
| Sessions | 7 days, extended daily while used; HttpOnly, `SameSite=Lax`, `Secure` in production; sign-out deletes the session server-side | |
| Editor | An expired session no longer navigates away from the editor: save/autosave return "session expired" and the draft stays in the browser's local copy | `editorActor()` in `src/lib/admin.ts` |
| Caching | `/account/**` and `/api/auth/**` send `Cache-Control: private, no-store` | `next.config.ts` |
| Rate limits | Better Auth: social sign-in 10/min, callbacks 20/min, link/unlink 10 per 10 min (Redis when configured, else Postgres). Profile edits 20 per 10 min and avatar changes 10/hour per user (`src/lib/rate-limit.ts`, same storage) | |

`/update-user` (Better Auth's generic profile endpoint) is disabled: profile changes go only through `/account`.
Email changes are not offered.

### Roles and the admin bootstrap (unchanged)

Roles are `user` (reader), `author`, `admin`. Social sign-in can never grant `author` or `admin`. The first
admin is still created once through `/setup` with `ADMIN_BOOTSTRAP_TOKEN` (the page disappears once an admin
exists); after that, admins change roles in Admin → Users. Existing users, passwords and sessions are not touched.

Every admin page and admin API checks the role on the server (`requireRole`, `staffActor`, `adminActor`,
`editorActor`); hiding the Dashboard link is only cosmetic.

## Callback URLs

Derived from `SITE_URL` (Better Auth's `baseURL`) and the auth route `/api/auth`:

| Environment | Google | GitHub |
|---|---|---|
| Production | `https://jithendar.com/api/auth/callback/google` | `https://jithendar.com/api/auth/callback/github` |
| Local (`npm run dev`, `SITE_URL=http://localhost:3000`) | `http://localhost:3000/api/auth/callback/google` | `http://localhost:3000/api/auth/callback/github` |

A mismatch shows `redirect_uri_mismatch` at the provider. `www.jithendar.com` redirects to the apex, so only
the apex URL is registered.

## Google setup

1. [Google Cloud Console](https://console.cloud.google.com/) → select or create a project for the site.
2. **Google Auth Platform → Branding** (older consoles: *APIs & Services → OAuth consent screen*): app name
   "Jithendar.com", support email, authorised domain `jithendar.com`, links to `https://jithendar.com/privacy-policy`
   and `https://jithendar.com/terms`. Audience: **External**.
3. **Data access**: add only `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. These are
   non-sensitive scopes, so no Google verification review is needed.
4. **Clients → Create client** (older: *Credentials → Create credentials → OAuth client ID*), type **Web
   application**. Authorised JavaScript origins: `https://jithendar.com` (and `http://localhost:3000` for a
   development client). Authorised redirect URIs: the Google URLs in the table above.
5. Copy the client ID and secret. Use a separate client for local development if you prefer to keep
   localhost out of the production client.
6. While the app is in *Testing*, only listed test users can sign in. **Publish** it for everyone.

## GitHub setup

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App** (an OAuth App, not a GitHub App:
   it needs no extra permissions and Better Auth requests only `user:email`).
2. Application name "Jithendar.com", homepage `https://jithendar.com`, authorization callback URL
   `https://jithendar.com/api/auth/callback/github`. Leave Device Flow off.
3. Generate a client secret; copy the client ID and secret.
4. An OAuth App has one callback URL, so create a second app (e.g. "Jithendar.com (local)") with
   `http://localhost:3000/api/auth/callback/github` for development.

## Configuration

| Variable | Where | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Secret `jithendar-com-env` | Both required to show the button |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Secret `jithendar-com-env` | Both required to show the button |
| `BETTER_AUTH_SECRET` | Secret (exists) | Also encrypts stored provider tokens (`encryptOAuthTokens`) |
| `SITE_URL` | Deployment env (`https://jithendar.com`) | Better Auth base URL; callback URLs derive from it |
| `AVATAR_MAX_BYTES`, `AVATAR_MAX_DIMENSION`, `AVATAR_MIN_DIMENSION` | Optional env | Defaults 2 MB, 4096 px, 64 px |

Production:

```sh
scripts/set-oauth-config.sh mk4      # prompts; secrets are read silently and never printed
kubectl --context mk4 -n jithendar rollout restart deployment/jithendar-com
```

The NetworkPolicy already allows HTTPS egress to the internet (token exchange with `oauth2.googleapis.com`,
`github.com`, `api.github.com`). Better Auth uses `SITE_URL`, not the request `Host`, for redirect URIs, and
reads the client IP from `X-Forwarded-For` set by Traefik; no proxy change is needed.

Local development: copy `.env.example` to `.env.local`, set `SITE_URL=http://localhost:3000`,
`BETTER_AUTH_SECRET` (any 32+ random characters), Turnstile keys (Cloudflare's test keys
`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` always pass) and the development OAuth
clients, then `npm run dev`.

## Database migration

`src/db/migrations/0006_account_profile.sql` adds `bio` (default `''`), `website` and `social_links`
(default `{}`) to `user`. It is additive with defaults and runs automatically at start-up (advisory-locked).
Rollback: deploy the previous image; it ignores the new columns. Linked Google/GitHub identities use
Better Auth's existing `account` table (no schema change).

## Errors users can see

Callback failures return to `/login?error=<code>` (or to Account settings while linking) and are shown as
plain sentences from `src/lib/auth-errors.ts`: cancelled consent (`access_denied`), no email from the provider
(`email_not_found`), expired or cross-browser attempt (`state_mismatch`), existing account not linked
(`account_not_linked`), registration closed, provider unavailable, already linked to another user,
stale session, last sign-in method.

## Tests

`tests/social-auth.test.ts` runs the real Better Auth handler on an in-memory Postgres with GitHub's token
and profile endpoints mocked: scopes/PKCE/state, off-site callback rejection, new-user role, encrypted
tokens, denied consent, missing email, state mismatch, registration closed, no implicit linking, explicit
linking (fresh session required), safe unlinking, blocked `/update-user`, profile ownership and allowlist,
field validation, session expiry and sign-out, admin access for readers. `tests/account-helpers.test.ts`
covers redirect sanitising, avatar URL allowlist and key layout, avatar validation and metadata stripping.

## Still to verify live (needs the real OAuth clients)

- Google and GitHub consent screens show the expected app name and scopes; sign-in completes on
  `https://jithendar.com` for a new reader, and an existing user can connect each provider.
- A GitHub account with a private primary email signs in (uses `/user/emails`).
- Avatar upload with R2 configured, and that replaced avatars disappear from the bucket.
