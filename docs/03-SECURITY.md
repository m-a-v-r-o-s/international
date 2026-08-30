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
| Resolve an exception / set a charge | ✓ | ✗ | ✗ |
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
   `{total_cents: 1}` must be rejected, not obeyed.
10. **Money is integer cents.** No floats anywhere in pricing or payment.

## Standing-profile checklist applied here

**Secrets** — Supabase service-role key, Anthropic API key, VAPID private key, SMTP
credentials: server-side env vars only. If one is ever committed, purge history *and rotate*.

**Input** — every payload validated server-side against a Zod schema (type, shape, length,
range). Client validation is UX only. All user text escaped on output; nothing rendered as
raw HTML. Every query parameterised. Upload endpoints: whitelist image MIME types by
sniffing content, cap size, store in a bucket with its own policy.

**Auth & sessions** — admin OTP; rep password (argon2id) + device PIN (argon2id, separate
hash). Sessions reset on password change. Reset links expire in 15 minutes and are rate
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

**AI boundary** — the OCR call is the one place untrusted third-party content reaches an
LLM. The prompt is fixed server-side; the licence image is the only variable input; the
response is parsed into a strict schema and anything outside it is discarded. Per-user and
per-day caps on OCR calls so a hostile or broken loop cannot run up an API bill.

**GDPR** — cookie consent banner, privacy policy page, terms page: three real components,
not placeholders. Licence images auto-purged on the retention schedule with each purge
logged. A documented process for a subject access or erasure request.
