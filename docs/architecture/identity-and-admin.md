# Login and administration

Accounts use MongoDB, following the legacy application's database choice. The legacy
implementation stored plaintext passwords and exposed debug user data; neither
behavior is carried forward. Authentication and admin APIs live inside the existing
AI gateway. No extra user/admin application microservice was added.

## Roles

| Role | Permissions |
| --- | --- |
| Customer | Browse, maintain an account-owned bag, calculate shipping and checkout after login |
| Admin | Customer permissions plus create/edit/archive products |
| Super admin | Admin permissions plus list users, promote/demote admins, disable users and edit public store settings |

Registration always creates customers and rejects a supplied role. Role checks run
on every admin request, using the current MongoDB user record. Changing a user's
role or disabled status invalidates existing sessions. Disabled users cannot log in.
The super admin cannot be disabled, demoted or replaced through the web API.

A MongoDB unique partial index on `role=superadmin` prevents two super admins even
when setup commands run concurrently. There are no default administrator credentials
and no public API for creating or promoting a super admin.

## Create the one super admin

Configure MongoDB first. For native development, set the following values in the
ignored `.env` (or inject them securely into the process environment):

```dotenv
MONGODB_URL=mongodb://YOUR-APP-USER:URL-ENCODED-PASSWORD@127.0.0.1:27017/robotshop?authSource=robotshop
MONGODB_DATABASE=robotshop
SUPERADMIN_EMAIL=YOUR-EMAIL
SUPERADMIN_NAME=Super Admin
SUPERADMIN_PASSWORD=YOUR-LONG-UNIQUE-PASSWORD
```

Then run:

```sh
npm run admin:bootstrap
```

The command requires a 12–128 character password and never prints it. It creates
one account and refuses to overwrite an existing super admin or reuse another
account's email. Remove `SUPERADMIN_PASSWORD` after successful setup. The development
launcher strips all bootstrap variables from its child processes.

For Compose, the gateway already has its MongoDB connection. Export the bootstrap
variables in your terminal through your local secret workflow, then run:

```sh
docker compose exec -e SUPERADMIN_EMAIL -e SUPERADMIN_PASSWORD -e SUPERADMIN_NAME \
  ai-gateway python services/ai-gateway/bootstrap.py
```

`docker compose exec -e NAME` forwards an **exported shell variable**; it does not
read the value from Compose's `.env` automatically. Do not put literal passwords
in shell command history. The setup script is packaged in the Python gateway image. For
Kubernetes, run the same command in the gateway pod with operator-supplied environment
values; no bootstrap credentials belong in Helm values or a public endpoint.

Visit the storefront's **Log in** button. After login, admins see **Admin panel**,
also available at `/admin`. Customers cannot read or mutate admin API data even if
they manually open that URL. The HTML shell itself is public; server data is protected.

## Shopping and account sessions

- Email/password registration, login, logout and current-user lookup are available.
- Checkout order creation, payment status and verification require login. Signed
  Razorpay webhooks remain available without a browser login.
- Login adopts a guest bag into a new account once and rotates its cart identifier.
  Returning accounts recover their existing bag and pending order; a guest bag is
  not merged into an existing account bag. A different account cannot access it.
- Logout clears authentication and cart cookies. The account bag stays available
  after logging in again. A cart cookie alone never grants account ownership.
- Passwords use salted scrypt (`N=32768, r=8, p=3`), an OWASP-listed configuration.
  [Password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Opaque 256-bit session tokens live in HttpOnly, SameSite=Strict cookies, with Secure
  enabled for HTTPS `PUBLIC_ORIGIN`. Only token hashes are stored in MongoDB.
- Sessions expire after eight hours. Each request checks expiration explicitly;
  MongoDB TTL cleanup is housekeeping, not the authorization decision.
- Login/registration are limited to 20 attempts per source IP per 15-minute window,
  with bounded concurrent password hashing. NGINX supplies the trusted client IP.
- Auth/admin mutations require an exact `Origin` match to `PUBLIC_ORIGIN`; credentials
  and session identifiers are omitted from logs, metrics labels and traces.

## Products and settings

Product-ingestion inserts missing seed SKUs at startup without overwriting admin
edits. All catalogue consumers read MongoDB. New products use the placeholder image
until an image with the matching SKU is deployed with the application assets.

Product editing uses a revision check to reject stale writes. Stock allocation is
the total inventory before subtracting completed sales and pending reservations.
Admins cannot reduce it below committed quantities. Products with pending payments
cannot be archived. Archiving hides products from the collection and prevents new
purchases while retaining existing order snapshots. Hard deletion is not offered.

The super admin can change store name, announcement, support email, and whether
new checkouts are accepted. Pausing checkout still permits resuming and verifying
existing pending orders. These are public settings; database URLs, payment keys,
model secrets, arbitrary scripts and infrastructure configuration are excluded.
Changes record the modifying user and timestamp on the affected product/settings
record. This is not an immutable audit-history system.

## API map

| Endpoint | Access |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login` | Public, origin-checked and rate-limited |
| `POST /api/auth/logout`, `GET /api/auth/me` | Current browser session |
| `GET /api/settings` | Public allowlisted settings |
| `GET/POST /api/admin/products` | Admin or super admin |
| `PUT /api/admin/products/:sku` | Admin or super admin; requires revision |
| `GET /api/admin/users?after=ID` | Super admin; cursor pagination |
| `PATCH /api/admin/users/:id` | Super admin; customer/admin role and disabled flag |
| `GET/PUT /api/admin/settings` | Super admin |

## Operational limits and verification

The gateway still stores carts, orders and inventory reservations in its single-writer
JSON ledger. MongoDB authentication does not make checkout horizontally scalable;
keep one gateway replica. Registered account bags are retained until a future retention
workflow is implemented. Email verification, self-service password recovery/change,
MFA, SSO and immutable audit export are not included in this change. Use database
backups and a controlled operator recovery process for loss of super-admin access;
rerunning bootstrap does not reset an existing account.

`tests/auth.test.mjs` uses real MongoDB and HTTP processes to verify concurrent
super-admin setup, password/session storage, cookie attributes, CSRF origin checks,
role denial, session revocation/expiry, catalogue edits, configuration allowlists,
account separation and restart persistence. DOM tests cover role-specific controls
and guest checkout login. The full shopping integration authenticates before payment.
