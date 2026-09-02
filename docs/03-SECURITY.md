# International Rentals — Security & Permission Model

The commercial point of this app is that **one rep cannot see another rep's business**.
That is not a UI concern. It is enforced in Postgres, and the UI merely reflects it.

## Threat model

The realistic attacker is **a logged-in rep with a valid session and a browser dev-tools
window**, not an anonymous stranger. Every control below assumes the client is hostile and
the session is genuine.

Second concern: the system holds **scanned driving licences of foreign tourists** — special-
category-adjacent personal data under GDPR. A breach here is a reportable incident.

## Permission matrix

| Capability | Admin | Rep (owner / hotel rep) | Rep (any other) |
|---|:--:|:--:|:--:|
| See car specs & photos | ✓ | ✓ | ✓ |
| See that a car is occupied on a date | ✓ | ✓ | ✓ |
| See **who** occupies it / why | ✓ | ✓ | ✗ |
| See booking customer & licence | ✓ | ✓ | ✗ |
| See booking price | ✓ | ✓ | ✗ |
| See own today's cash in hand | ✓ | ✓ | n/a |
| See any other total, sum or average | ✓ | ✗ | ✗ |
| See revenue / reports / CSV export | ✓ | ✗ | ✗ |
| Create a booking (any hotel) | ✓ | ✓ | ✓ |
| Edit own booking before pickup | ✓ | ✓ | ✗ |
| Extend own booking after pickup | ✓ | ✓ | ✗ |
| Any other post-pickup edit | ✓ | ✗ | ✗ |
| Change a price | ✓ | ✗ | ✗ |
| Override eligibility block | ✓ | ✗ | ✗ |
| Resolve an incident / set a charge | ✓ | ✗ | ✗ |
| Record fuel money taken at a return | ✓ | ✓ | ✗ |
| Re-date or re-attribute a handover | ✓ | ✗ | ✗ |
| Add / archive / delete a car | ✓ | ✗ | ✗ |
| Block a car's dates / see block reason | ✓ | ✗ | ✗ |
| Edit price tables & pricing periods | ✓ | ✗ | ✗ |
| Manage users & hotels | ✓ | ✗ | ✗ |
| Read the audit log | ✓ | ✗ | ✗ |

"Rep (owner / hotel rep)" = the rep who **created** the booking, or a rep assigned to the
**hotel** the booking belongs to. Both, per the cover-shift decision.

## Rules the implementing agent must not bend

1. **No aggregate reaches a rep.** Not a count, not a sum, not an average, not a
   "12 cars rented today". The single exception is their own cash in hand for the current
   day. If a screen needs a number, ask whether a rep could infer company revenue from it.
2. **`availability()` returns car ids and dates. Nothing else.** No booking id, no status,
   no rep, no hotel, no reason, no times. If a future feature "just needs" one more column
   there, it does not.
3. **A block and a booking are indistinguishable to a rep.** `block_reason` is never sent to
   a rep's device under any circumstance.
4. **Price is computed server-side and only server-side.** No price table is ever shipped to
   a rep's client — a rep could otherwise read every category's rates for the whole season.
   The rep receives one number for the booking in front of them.
5. **Every write re-checks authorisation server-side.** A hidden button is not a control.
6. **RLS enabled on every table**, with real policies. No table relies on the client sending
   the right filter.
7. **Service-role key never leaves the server.** The browser gets the anon key only.
8. **Licence images: private bucket, signed URLs, short TTL**, issued only after re-checking
   the caller may see that booking. Never a public URL, never a permanent one.
9. **Mass-assignment blocked.** Whitelist writable fields per endpoint. A rep POSTing
   `{total: 1}` must be rejected, not obeyed.
10. **Money is a whole euro integer.** No cents, no floats anywhere in pricing or payment.

## Standing-profile checklist applied here

**Secrets** — Supabase service-role key, Anthropic API key, VAPID private key, SMTP
credentials: server-side env vars only. If one is ever committed, purge history *and rotate*.

**Input** — every payload validated server-side against a Zod schema (type, shape, length,
range). Client validation is UX only. All user text escaped on output; nothing rendered as
raw HTML. Every query parameterised. Upload endpoints: whitelist image MIME types by
sniffing content, cap size, store in a bucket with its own policy.

**Auth & sessions** — admin OTP; rep PIN (argon2id), which since §32 is both the sign-in
credential and the device unlock. The boss issues it and can re-issue it, and a re-issue
rotates the account's GoTrue password with it, so nothing older keeps working. Since §38 a
PIN that came from him is temporary: `pin_must_change` is set with it, the rep is redirected
to `/change-pin` until they replace it, and a chosen PIN must be six digits and not a run or
a repeat. Changing one requires the current one — the screen sits behind a shift-length
unlock window on a phone that lives on a front desk. `public.set_pin_hash()` remains the only
writer of both columns, `service_role` only; a rep gets no grant, no policy and no RPC. Reset links for the
admin's own path expire in 15 minutes and are rate
limited. Account lockout after repeated failures. **No user enumeration** — login and reset
give the same response whether or not the email exists. Cookies `HttpOnly` / `Secure` /
`SameSite=Lax`. CSRF tokens on every state-changing request.

**Admin concurrent sessions** — the boss is signed in on desktop and phone simultaneously.
Sessions are tracked individually; signing in on one must never invalidate the other.
He can see and revoke his active sessions.

**Infrastructure** — HTTPS forced, HSTS, CSP, `X-Content-Type-Options: nosniff`,
frame-ancestors, `Referrer-Policy`, `Permissions-Policy` (camera on, everything else off).
CORS locked to the app origin and the TWA origin — never a wildcard. Directory listing off.
Admin routes not guessable. Database role restricted to what the app needs.

**Data at rest** — licence numbers and dates encrypted at rest on top of platform
encryption. API responses trimmed to the fields the screen actually needs — never a whole
row with internal flags attached.

**Logging** — failed logins, password resets, admin edits, eligibility overrides, signed-URL
issuance for licence images, and every retention purge. Rate-limit the logging itself so a
hostile loop cannot flood storage. **Never log secrets, tokens, licence numbers or full
request bodies.**

Since the customer ledger (docs/01-DECISIONS.md §25a) that list also includes every
cross-booking action on guest identity, because the ledger is readable company-wide and an
open door needs a record of who walked through it: `customer_lookup` (every match attempt,
hit or miss, with the caller and **never the number tried**), `customer_consent` and
`customer_consent_withdrawn`, `licence_image_reused` (both bookings, no path),
`customer_erased` and `customer_ledger_cleared` (counts only). `public.customers` itself is
deliberately **not** in the audit log — see §25a: auditing a table whose whole point is that
it can be erased on request would write the guest's name and date of birth into a table with
no erasure path, in the same statement that claimed to erase them.

**AI boundary** — the OCR call is the one place untrusted third-party content reaches an
LLM. The prompt is fixed server-side; the licence image is the only variable input; the
response is parsed into a strict schema and anything outside it is discarded. Per-user and
per-day caps on OCR calls so a hostile or broken loop cannot run up an API bill.

**GDPR** — cookie consent banner, privacy policy page, terms page: three real components,
not placeholders. Licence images auto-purged on the retention schedule with each purge
logged. A documented process for a subject access or erasure request.

The customer ledger is the one store here with **no automatic expiry** — the owner's
decision, argued out in docs/01-DECISIONS.md §25a — so its compensating controls are load
bearing rather than nice to have: consent is a separate tick box beside the signature and
never bundled into the agreement, withdrawal really deletes, `admin_erase_customer()` takes
the guest's licence photographs with the record and does it through the Storage API, and the
privacy policy states in plain words that these records are kept indefinitely rather than
implying a window that does not exist.
