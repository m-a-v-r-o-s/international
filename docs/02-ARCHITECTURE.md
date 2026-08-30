# International Rentals — Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router, TypeScript)** | Server-side authorisation on every request, server-only price + availability logic, one codebase for phone and the boss's desktop |
| Hosting | **Railway** | Standing default |
| Data / auth / storage | **Supabase** (Postgres, Auth, Storage, RLS) | Standing default; RLS is the backbone of the rep-isolation rule |
| Android app | **Trusted Web Activity** via Bubblewrap → Play Store | Play listing without a second codebase; updates deploy instantly, no store review |
| OCR | **Claude vision** (`claude-sonnet-5`) server-side | Licence read; never called from the browser |
| PDF | **@react-pdf/renderer** + Noto Sans (Greek + Latin glyphs) | Deterministic, no headless browser on Railway, handles bilingual text and the damage diagram |
| Signature | HTML canvas → PNG → embedded in the PDF | No dependency needed |
| Push | Web Push (VAPID) — works in a TWA on Android | Rep day reminders, admin exceptions |
| i18n | `next-intl` | Greek / English, per-user preference |

**Escalation justified:** this is not a static site. It needs authenticated multi-user
access, server-enforced row-level authorisation, camera capture, PDF generation and an
LLM call. Next.js is the correct rung on the ladder here, not the reflexive one.

### Why NOT React Native
A second codebase for a single-boss desktop view, plus a Play review queue on every
mid-season bugfix. A TWA gives the Play listing, the camera and push, with instant deploys.

---

## The two engines that must be exactly right

Everything else in this app is CRUD. These two are where correctness lives, and both run
**server-side only**. The client never computes a price and never decides availability.

### Engine 1 — Availability

**Rule:** a car is occupied on date `D` if any non-cancelled hold on that car covers `D`,
where the range is **inclusive of both the start and end date** (the guest keeps the car
until 21:00 on the final date).

Two bookings on the same car may therefore touch but not overlap: one ending 15 Jul and the
next starting **16 Jul** is legal. One starting 15 Jul is not.

**Implementation: a single `bookings` table holding both rentals and admin blocks**, with a
`kind` column. A block is a row with `kind='block'`, no customer and no price.

This is deliberate and it does two jobs at once:
1. One exclusion constraint protects everything.
2. A rep querying availability cannot tell a block from another rep's booking — which is
   exactly the required behaviour, achieved by construction rather than by careful coding.

**The guarantee is a Postgres exclusion constraint, not application logic:**

```sql
EXCLUDE USING gist (
  car_id WITH =,
  daterange(start_date, end_date, '[]') WITH &&
) WHERE (status IN ('booked','out','blocked'))
```

Two reps racing for the last car cannot both win. A bug in the UI cannot double-book.
The database refuses it. **Never remove this constraint to "fix" a failing insert** — a
failing insert means the car is genuinely taken; surface it to the rep.

**Early return frees the car:** processing a return sets `status='returned'`, which drops
the row out of the constraint predicate and out of availability. Dates after the actual
return reopen immediately. The **price does not change** — the guest still pays the full
booked duration.

**Reps never query `bookings` for availability.** They call a `SECURITY DEFINER` function:

```sql
availability(from_date date, to_date date)
  → (car_id uuid, occupied_dates date[])
```

It returns car ids and occupied dates. No booking ids, no rep, no hotel, no customer, no
price, no reason. It is the only channel through which a rep learns that a car is taken, and
it leaks nothing else. RLS on `bookings` itself stays strict.

### Engine 2 — Pricing

```
days          = (end_date - start_date) + 1          -- inclusive
period        = the pricing period containing START_DATE   -- pickup date decides
if days <= 7  : total = price_rows[period, category, days].total
else          : total = price_rows[period, category, 7].total
                      + (days - 7) * price_extra_day[period, category]
```

- Totals are typed by the admin and already contain the first-day premium. **The app adds
  nothing.**
- Money is **integer cents** everywhere. No floats, ever.
- The period id used is **stored on the booking** so a later change to the price tables
  never silently rewrites history.
- If the pickup date falls in no defined period, quoting **fails loudly**. It does not
  guess, and it does not fall back to another period.
- Baby seats and additional drivers are **free** and add nothing to the total.

Exposed as an RPC `quote(category_id, start_date, end_date)`. The rep's device displays what
the server returns and can neither alter it nor recompute it.

---

## Security model

Per the standing profile, plus what this app specifically needs. Full checklist in
`03-SECURITY.md`; the shape is:

**RLS is the product, not a feature.** Every table has it on. There is no code path that
reads booking data without a policy applying.

```
bookings (kind='rental') readable by a rep when:
    created_by = auth.uid()
    OR hotel_id IN (SELECT hotel_id FROM hotel_reps WHERE profile_id = auth.uid())

bookings (kind='block')  never readable by a rep at all
                         (they learn of blocks only via availability(), as opaque dates)

everything financial, aggregate or cross-rep  →  admin-only RPC with an explicit role check
```

**Licence images** live in a **private** Storage bucket. No public URL exists. The server
issues a short-lived signed URL only after re-checking that the caller may see that booking.
Access is logged.

**The OCR call is an untrusted-input boundary.** The image comes from a member of the public
holding a card. Treat text extracted from it as data, never as instruction — the extraction
prompt is fixed server-side, the response is parsed into a strict schema, anything outside
the schema is discarded, and per-user rate limits cap the spend.

**Reps are the realistic threat model here**, not anonymous attackers. A rep with a valid
session who edits an API call must not be able to reach another rep's revenue. That is why
authorisation is in the database, not in the route handler.

---

## Non-functional requirements (standing profile — non-negotiable)

- **Mobile-first.** Reps work one-handed on a phone at a hotel desk, often in sunlight.
- **WCAG 2.1 AA** throughout: contrast, keyboard navigation, ARIA labels, focus order.
  The camera and signature flows need accessible non-visual paths too.
- **Core Web Vitals green** — verified, not assumed. The day sheet may carry ~200 rows at
  peak; it must not jank.
- HTTPS forced, HSTS, CSP, `nosniff`, frame-ancestors, `Referrer-Policy`,
  `Permissions-Policy` (camera allowed, everything else denied).
- Cookies `HttpOnly` / `Secure` / `SameSite`. CSRF tokens on every state-changing request.
- Rate limiting on auth, OCR, and every write endpoint.
- Privacy policy page, terms page and a cookie consent banner — three real components.
- Custom branded 404. Real favicon. Open Graph image.
- Footer credit: **© {year} Akos Digital Services**, with "Akos Digital Services"
  linked to `https://akosds.com`.
- `npm audit` clean before each milestone.
