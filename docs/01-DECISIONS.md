# International Rentals — Locked Decisions

Client: International Rentals (Greece) · ~100 cars · 20 models · 8 categories
Author: Akos Digital Services (Theodoros)
Decided: 2026-08-30 · Source: structured interview with the client-side domain expert (former rep at this company)

**These are settled. Do not re-litigate them. If a build decision appears to
contradict something here, the decision here wins — raise it, don't quietly change it.**

## 1. Roles

| | Admin (the boss) | Rep |
|---|---|---|
| Count | 1 | 6–10 |
| Sees | Everything | Own bookings + own hotel's bookings only |
| Fleet | Full CRUD, archive, block dates | Read specs + free/blocked dates only |
| Prices | Sets the tables | Sees the price on their own bookings only |
| Reports | Yes | Never |
| Sessions | Desktop **and** mobile concurrently | One device |

## 2. Booking unit
Bookings are made against a **specific car (plate)**, not a category. Availability is a
per-plate calendar.

## 3. Locations
A location is a **hotel**. Each rep is stationed at one hotel. Room number is captured
because guests are hotel guests.

The fleet is **one shared pool** — any rep can book any free car in the company.

## 4. Day counting (critical — get this exactly right)
- A day is **morning to night**, not 24 hours.
- Days charged = **inclusive count of calendar dates** from pickup date to return date.
  Mon pickup → Wed return = **3 days**.
- The customer keeps the car until **21:00 on the final date** at no extra cost.
- **Early return earns no refund.** The full booked duration is charged.
- **Early return DOES free the car.** When the return is processed, the remaining dates
  reopen in availability immediately so the car can be re-let.
- **No turnaround gap.** A car returned Wed 19:00 is bookable Thu 08:30.

## 5. Operating windows
- Pickups **08:30–11:30**, drop-offs **18:00–21:00**.
- These are **defaults, overridable** per booking. The override is recorded.
- No out-of-hours fee.

## 6. Pricing
- Admin defines **pricing periods** as arbitrary date ranges, re-editable every season
  (roughly 4 per season: low start → mid → peak Aug/Sep → low end Oct). Nothing about
  months or season boundaries is hard-coded.
- Rate table shape: **total price** for `category × period × duration`, durations **1–7 days**.
- **8+ days** = the 7-day total **+ a per-extra-day rate** the admin also sets.
- The +€5 first-day premium is **already baked into the numbers the admin types**. The app
  performs no first-day arithmetic of its own.
- **Cross-period rentals: the pickup date's period prices the whole rental.**
- **Price is locked.** Reps cannot discount, override or negotiate. Only the admin can
  amend a price, and the amendment is audit-logged.

## 7. What a rep sees about money
- The price on **their own** bookings. Nothing else.
- **One** aggregate only: **today's own cash in hand** — cash they have collected today and
  not yet **confirmed received by the boss** (see §31), with a "hand over" action.
- No revenue history, no monthly totals, no averages, no company figures, no other rep's
  anything. **Not even indirectly** (no totals row, no counts that imply revenue, no
  "cars rented today" company-wide).
- **No commission** exists in this business. Do not build commission anywhere.

## 8. Cross-rep visibility — the hard rule
A rep looking at any car they do not have a booking on sees **occupied dates and nothing
else**. No rep name, no hotel, no customer, no times, no price, no reason.

A block placed by the admin (service, repair, write-off) is **visually identical** to
another rep's booking. This is deliberate.

**Exception:** a booking is visible to the rep who **created** it *and* to the rep assigned
to the **hotel** it belongs to. (Reps cover for each other; both need it in their history.)

## 9. Customer & driver data
Captured per booking:
- First name, last name
- **Hotel room number**
- **Phone**
- **Date of birth**
- Email — **optional**, asked only at the signing step to send the contract copy
- Driving licence: **photo of front and back**, plus number / country / issue date / expiry
- **Additional drivers: free of charge**, but their licence is captured identically

## 10. Licence OCR
Camera capture → **auto-read via Claude vision** → pre-filled, **always editable** form.
Manual entry is a first-class fallback, not an error path. Worn, non-Latin and non-EU
licences must not block a pickup.

## 11. Eligibility — HARD BLOCK
| Categories | Minimum age | Licence held |
|---|---|---|
| A, B | 21 | ≥ 1 year |
| C – H | 23 | ≥ 1 year |

Plus: the licence must be valid and unexpired **through the return date**.

A failing driver **cannot be picked up**. Only the **admin** can override, and the override
is recorded on the booking and raised as an exception. Minimum ages are admin-editable per
category — do not hard-code 21 and 23 in application logic.

## 12. Condition recording
- **Fuel level** out and in (eighths).
- **Damage marked on a car diagram**, tappable, with an optional photo per mark.
  Pre-existing marks carry forward from pickup; new marks at return are distinguished.
- **No odometer. No km. No mileage-based servicing.** Explicitly out of scope.
- Fuel policy is **same-to-same**.

## 13. Booking lifecycle
`Booked → Out → Returned`, plus `Cancelled` and `No-show`.
No quote stage. No settlement stage.

## 14. Anything non-standard goes to the boss
Fuel shortfall, new damage, late return, no-show, eligibility override — the rep **records
the evidence and flags it**. They never price it, never argue it, never collect it.
Each flag creates an item in an **admin exceptions queue** where the boss decides the amount
and closes it.

## 15. Payment
Amount collected + method (cash / card / transfer) + paid / partially paid / unpaid.
**No security deposit** is taken. Do not build deposit handling.

## 16. Rental agreement
The app **generates the agreement as a PDF** and the customer **signs on screen**.
- Bilingual (Greek + English) on the same document.
- Includes the damage diagram and both drivers' licence details.
- Stored against the booking.
- Optional email delivery at the signing step; skipped if the guest declines.

## 17. Fleet management
- Admin can **add, archive and delete** cars.
- Admin can **block a date range** on a car (reason is admin-only text). Blocks are how
  service, repair and write-offs leave availability.
- Car record: photo, plate, make, model, category, year, colour, transmission, fuel type,
  seats, doors, A/C, tank size.
- **No insurance / ΚΤΕΟ / road-tax expiry tracking.** Out of scope.

## 18. Rep booking rights
- **Before pickup:** edit anything on their own booking, or cancel it.
- **After pickup:** locked, with **one exception** — they may **extend** the return date.
  If the same car is booked later, the app offers a free car in the same category and the
  guest swaps vehicle. Re-pricing on extension uses the same rules (pickup date's period).

## 19. Admin edits
Instant, no approval, no notification to the rep. **Every change is audit-logged**
(actor, entity, before, after, timestamp) and the log is permanent.

## 20. Admin screens
Today's movements sheet · live fleet board · full booking search · simple revenue reporting
(by day / month / rep / category) with CSV export · exceptions queue.

## 21. Auth
- **Admin:** email + one-time code. Concurrent desktop and mobile sessions allowed —
  signing in on one device must never sign out the other.
- **Reps:** email + password on first use, then **PIN or fingerprint** to reopen.
  Device-bound session. — **The password half is superseded; see §32.** A rep now signs in
  with their PIN and nothing else, and the boss issues it. The device binding, the
  shift-length unlock and the admin's own path above are unchanged.

## 22. Notifications
- **Admin:** exceptions — damage flagged, car not returned, eligibility override.
- **Reps:** morning summary of their pickups, evening reminder of returns due.

## 23. Platform
**Android only.** A Next.js web app **wrapped as a Trusted Web Activity** and published to
the Play Store. The boss additionally uses it in a desktop browser.
**Online connection required** — with safe retention of an in-progress form if signal drops.

## 24. Language
Greek and English, switchable per user. Contract always bilingual.

## 25. Data retention (GDPR)
Licence images are **auto-deleted** after an admin-set window (default **24 months** after
the rental ends). The booking record, contract PDF and typed licence number are retained.
Every purge is logged.

## 25a. Ψηφιακό πελατολόγιο — the customer ledger
Until this was built the app had **no cross-booking customer identity at all**. Every
booking was its own island; a guest who rented last August and rents again this August was
two unrelated rows that happened to share a phone number. Reps asked for a returning guest's
details to fill themselves in, and that needs something to fill them in *from*.

**What it is.** One row per guest, keyed on their phone number, holding the fields the
pickup form asks for: name, date of birth, licence number, country, issue and expiry dates,
and a pointer to their last licence photographs. It holds **no booking history** — no
hotels, no rooms, no prices, no rep names. It is a form-filling aid and its columns are
exactly the fields of the form it fills.

**Phone numbers are normalised, in the database.** `bookings.cust_phone_e164` is a
*generated column* over `app.phone_e164(cust_phone)`, so the canonical form exists for every
row written by any route and cannot be sent by a client at all. A number that cannot be
resolved to a country without guessing — a bare `07911123456` — normalises to **null** and
is never matched or ledgered. Guessing wrong here does not produce a failed match; it
produces a match against *someone else*, on a form that fills a rental agreement.

### The three decisions, and who made them
All three were the owner's (Θεοδωρής, 31 Aug 2026), and two of them went against the advice
given at the time. They are written down here in full, including the advice, because the
code cannot record why a weaker option was chosen over a stronger one.

**1 · Retention is manual. There is no window.**
> *Asked:* how long after a guest's last rental should the ledger keep them — with a 5-year
> window (the figure usually argued for a customer ledger tied to Greek commercial and tax
> records) offered as the default, and everything admin-configurable either way.
>
> *Chosen:* no automatic expiry at all. Records are kept until the boss presses a
> clear-the-ledger button, which he asked to be guarded by three separate confirmations so
> he could never press it by mistake.
>
> *Advice given, and overruled:* an indefinite store of names, dates of birth and licence
> numbers is what GDPR's storage-limitation principle (Art. 5(1)(e)) is specifically about,
> and the privacy policy would have to say in writing that we keep licence numbers with no
> end date. A window and a manual button are not mutually exclusive — both were offered
> together. The owner reaffirmed manual-only when asked a second time.

**2 · The legal basis is separate, explicit consent — not the contract.**
The owner's first answer was that the rental agreement would carry a clause covering it. The
objection was that consent bundled into a contract the guest must sign to get the car is not
freely given (**Art. 7(4)**), and the owner's own answer to that objection is what is now
built: *"we will put a separate box for them to tick just by where their digital signature
will be, so they're aware of it."* That is the right fix and it is the whole basis:

- a **separate tick box beside the signature**, never inside the agreement;
- **unticked by default**; signing with it untouched keeps the guest out of the ledger
  entirely and changes nothing about the rental;
- `customer_bookings.consent_at` is the evidence that it was ticked, per booking;
- **un-ticking on a re-signature is a withdrawal** and really deletes
  (`withdraw_customer_consent` → the orphan trigger drops the customer when their last
  consenting booking goes).

Nothing lands in the ledger because a booking was made. Consent is the only door in.

**3 · The lookup is company-wide — which resolves §29's first open question.**
§29 asked whether reps search all past customers or only their own, and *assumed* the
narrow answer. The assumption is **overruled**: any rep may match any past customer,
company-wide. This is a real widening of §8's cross-rep rule and is treated as one, so the
door is narrow even though it is open to everyone:

- reps hold **no `SELECT` on `public.customers`**. Their entire access is
  `public.customer_by_phone()`, a security-definer function;
- it matches on a **complete, exact** number — no prefix, no `LIKE`, no name search, no
  "did you mean". A rep who does not already know the number learns nothing;
- it returns **at most one row**, and never the phone number back, and never a booking,
  hotel, room, price or rep;
- it is **rate limited in Postgres** (120/hour per rep), not in the app, because the app is
  not the only thing that can call a PostgREST function with a rep's token;
- **every call is logged** — hit or miss, with the caller, never the number tried.

An exact-phone match **fills the form immediately**, with no confirm step; that was also the
owner's choice over requiring a surname match. The compensating control is that the screen
*says* the fields came from a previous rental, whose, and when, before the rep saves
anything.

### Licence photographs are copied, never shared
Reusing a returning guest's licence photos **copies the object into the new booking's own
folder**. Pointing the new booking at the old object, or signing a URL against the old path,
were both rejected: every licence image is swept on **its booking's** clock, read from its
path (§25), so a shared object would either be deleted while the second rental was current
or outlive the window on a technicality. A copy gets its own clock. Nothing widens read
access to the old path.

This is also the **one place the service role reads across the §8 boundary** — by
construction the rep in front of the guest may not be able to read the booking the photo
came from. It is fenced: the rep must be able to write the *target* booking first, the
source path can only ever be one a consenting customer's own ledger row points at, the path
is re-parsed and refused unless it is a `licences` object, the bytes are re-sniffed, it is
rate limited, and every copy logs both bookings. It is a **button**, never automatic —
copying a photograph of a driving licence between rentals is a heavier act than filling in
a text field, and if the number was mistyped it would put a stranger's licence in the
agreement.

### `customers` is deliberately not audited
Every other table of consequence has an `app.audit()` trigger. This one does not, and the
reason is the erasure path: `app.audit_redact()` strips licence numbers and image paths but
not names, dates of birth or phone numbers, so auditing this table would mean
`admin_erase_customer()` deletes the guest's record and, in the same statement, writes their
name and date of birth into a table with no erasure path. That is a right-to-erasure
obligation marked done with the data still there. The *changes* are recorded without the
personal data, as security events: `customer_consent`, `customer_consent_withdrawn`,
`customer_lookup`, `customer_erased`, `customer_ledger_cleared`, `licence_image_reused`.

### What a guest gets when they ask to be forgotten
`admin_erase_customer()` removes the ledger row, its consent links, and their licence
photographs — the last through the Storage API, because deleting the metadata row would
leave the file in the bucket (§25's lesson). It does **not** delete their bookings or the
signed agreements: those are held under a different obligation and §25 already says the
booking record and the typed licence number are retained. The privacy policy says exactly
that, in those words.

### Still owed
The consent clause needs to exist in the **rental agreement's terms** in both languages when
the client finally supplies them (§28 item 5) — the tick box is the basis, but the agreement
should not be silent about it. Until then the ledger is running with the basis asserted and
the paperwork half-written.

## 26. Explicitly out of scope
- Customer-facing online booking / public website
- Invoicing, official receipts, myDATA e-invoicing, accounting integration
- WhatsApp / SMS messaging to guests
- Odometer, mileage and service scheduling
- Commission
- Security deposits
- Offline booking creation

The data model must not *preclude* a public booking channel later, but no work goes into it now.

## 27. Timeline
| Date | Milestone |
|---|---|
| **early October 2026** | Test build — "as close to release as possible" |
| Oct 2026 – Feb 2027 | Feedback from the boss and reps, refinement only |
| **1 March 2027** | Production launch |
| 1 May 2027 | Season opens with the system live |

## 28. Data the client still owes us
1. The **8 category names** (A–H) and which of the 20 models sit in each.
2. The **20 models** with specs and **tank size in litres**.
3. The **fleet list** — 100 plates with model, year, colour (CSV preferred).
4. **Price tables** — at least one pricing period, ideally all four.
5. A **scan of the current paper rental agreement** and its terms and conditions,
   in both languages if it exists bilingually.
6. **Hotel list** and which rep covers each.
7. **Company legal details** for the contract: registered name, address, VAT (ΑΦΜ),
   phone, insurance provider and policy terms.
8. Domain name, and a **Google Play developer account** (€25 one-off).

## 29. Open questions still unanswered
- ~~Do reps need to **search past customers** for a returning guest, or is every booking a
  fresh record?~~ **Resolved 31 Aug 2026 — see §25a.** The assumption recorded here (reps
  search only within bookings they can see) was put to the owner and **overruled**: any rep
  may match any past customer company-wide, by exact phone number only, through one
  rate-limited and logged function, and never by browsing.
- Is there a **minimum rental length**? *(Assumed: 1 day.)*
- Is there a **maximum forward booking window**? *(Assumed: none.)*
- Which fuel charge rate applies — a per-litre figure or the boss's judgement each time?
  *(Assumed: the boss's judgement, since all fuel shortfalls route to him as exceptions.
  The app records the shortfall in eighths and litres, and charges nothing automatically.)*

## 30. The boss at the desk, and two front-desk actions that reach every screen

The owner's ask, in his words: admin accounts should be able to operate like rep accounts
too — *"even the boss makes bookings sometimes"* — the Ψηφιακό πελατολόγιο should be its own
sidebar item rather than a section buried in Settings, and the header should carry two new
buttons: a **booking confirmation** for a guest who orders a car by phone, and **write up
the full contract**, which opens the licence-photo-and-signature flow either against an
existing booking slip or from nothing at all for an impromptu rental.

### What was actually broken

The admin could not create a rental, and the reason was not the missing link. Every
booking-flow route already gates on `requireUnlocked()` rather than `requireAdmin()`, so the
boss could reach `/bookings/new` by typing it — and the insert at the end of it would have
failed. `app.bookings_before_write()` fills `created_by` inside `if not v_is_admin`, along
with the fields a rep is not trusted to send; `bookings.created_by` is `not null` with no
default and is absent from the INSERT grant **for the admin too**, so it could not be
supplied from a client either. Every admin-created booking was a NOT NULL violation waiting
for someone to find it. Nothing had, because the only admin insert path in the app —
`public.admin_create_block()` — passes `created_by := auth.uid()` itself.

`20260831140000_admin_creates_rentals.sql` fixes it with a second BEFORE trigger,
`bookings_owner`, rather than an edit to the guard: that function is 200 lines of
load-bearing transition rules, it has been re-pasted whole once already (0015), and 0021
declined to paste it again to add two lines for exactly this reason. The new trigger only
ever fills a `created_by` the guard left null, so a rep's row — already stamped with
`coalesce(auth.uid(), …)` — behaves exactly as before, and a service-role insert with no
`auth.uid()` still has to name an author rather than being quietly given one.

**A second finding, from the test that caught it.** `tests/db/privileges.test.ts` asserts the
exact list of `app` functions `authenticated` may execute, and it failed on the new function.
0025 withdrew Postgres's built-in EXECUTE-to-PUBLIC across `app` and wrote the same
withdrawal as a *default privilege* so later functions would be covered without anyone
remembering — and they are not: there is no `pg_default_acl` row for the schema, so a
function created after 0025 arrives with `proacl` null and the built-in grant intact. It is
now revoked by name. **Every future function added to `app` needs that line until the
default itself is fixed**, and the test is what will keep saying so.

### The four decisions, and who made them

All four were the owner's (Θεοδωρής, 1 Sep 2026), put to him before anything was built
because each has a UX or compliance consequence that a default would have got wrong. Three
went the way the advice went; one deliberately did not, and is written down as such.

**1 · Both new buttons are for reps and for the admin. The ledger link is not.**
> The ask was "admin gains rep capabilities", not "reps lose or gain something", so the two
> header buttons belong to whoever is standing at a desk — which is both roles. They sit in
> a second header row rather than squeezed into the first: at 360px the top row is already a
> burger, a logo and three text links, and a phone call arrives while the rep is looking at
> some other screen.
>
> The Ψηφιακό πελατολόγιο stays admin-only, and that is not a UI choice. §25a gives reps no
> `SELECT` on `public.customers` at all — their entire access is one rate-limited,
> exact-match, logged function — and erasing a guest or clearing the ledger are admin RPCs
> that refuse a rep twice over. A sidebar link for a rep would be a link to a refusal.

**2 · The phone booking collects the number, the room, the car, the dates and the seats — and
offers a name it never requires.**
> *Asked:* whether the quick form should ask for the guest's name at all, even optionally,
> or defer identity 100% to pickup as the instruction "collects ONLY" says.
>
> *Chosen:* an optional name field, never required.
>
> *Why the letter of the instruction was not followed:* R1 Today and A1 Movements both print
> a guest name per row, and a booking with none prints a blank there until the contract is
> written — on the boss's morning sheet as well as the rep's. A rep who was given a name on
> the call can record it; a rep who was not is never held up by a required field. The date of
> birth genuinely is deferred, in full: `cust_dob` is written null and read off the licence
> at pickup (§9, §10), where it is needed for the eligibility gate anyway.
>
> The form also **shows** the price, which is not a field it collects. The guest's next
> sentence after naming the dates is "how much is that?", and the alternative is a rep
> quoting from memory or booking-then-cancelling when the guest declines. It is the same
> read-only `public.quote()` R3 shows, computed server-side, never in the browser (§6). Say
> so if it should come off.

**3 · The walk-in runs the eligibility check first, then continues through the whole pickup
to `Out`.**
> *Asked:* whether "write up the contract" stops at the signed PDF and leaves fuel, damage
> and payment for later, and whether the §11 eligibility hard block — which sits on the
> `booked → out` transition, not on signing — should be evaluated earlier for this path.
>
> *Chosen:* the gate first, then the rest of R4 inline, ending at `Out`.
>
> *What made this weightier than it first looked:* R4 already refuses to show the agreement
> step until the gate passes (`agreement: gateOpen && pickup !== null`). So a global entry
> point that jumped straight to a signature would not merely have reordered an unenforced
> rule — it would have **removed a check that exists today**, and let a guest sign a rental
> agreement for a car they are not legally allowed to drive. Both new doors therefore open at
> the FIRST step of the pickup flow, never at the signature. And a walk-in is one transaction
> to the rep: a rental left half-processed at the moment the car drives away is the paper
> problem this app exists to replace.

**4 · The admin's sidebar is his own list with the rep screens appended under a heading.**
> *Asked:* additive, one flat merged list, or a mode toggle.
>
> *Chosen:* additive, grouped. Nothing is removed, and there is no mode to be in the wrong
> one of — a toggle would have re-created the "cannot get there from here" problem that
> prompted the ask.
>
> `/` is deliberately **not** in the appended group, and this is the one place the
> implementation narrowed what was described. For an admin `/` is not a Today screen at all;
> it is his landing card, and A1 Movements is his morning screen. Listing it under "Today"
> would have named it wrongly, and the logo links there for everyone regardless.

### What these screens are not

The contract picker lists `booked` rentals with no `contracts` row. A rental already `out`
without a signed agreement is **not** listed, because R4 stops at "already out" and the link
would be to a dead end. That combination is possible — the agreement is a step and not a
gate, and nothing in the database requires a signed contract to reach `out` — so if it turns
out to happen in practice, it wants an exceptions-queue item (§14) rather than a second
signing path.

Neither new screen is a second way to write a booking. Both go through the same `bookings`
insert, the same guard trigger and the same exclusion constraint as R3, so a phone booking
that double-books a car is refused with the same 23P01 as any other, and the price still
comes from the engine rather than from anything either form sends.

## 31. Cash hand-over: the boss's confirmation is what clears the figure

The owner's ask, in his words (1 Sep 2026): almost always the cash in hand gets delivered to
the boss by the rep at the end of the morning shift, but sometimes there is extra money to be
returned at the end of the night shift too — a rare night-shift pickup, or a delayed payment —
and **only the boss should be able to zero what a rep is shown as still owing.**

That was not what `public.my_hand_over_cash()` did before this decision. It is
`SECURITY DEFINER` and callable by the rep alone, and the moment a rep called it, the
bookings it covered were stamped with a `cash_handover_id` — the one thing
`public.my_cash_in_hand()` (§7) excluded. So a rep's own tap cleared their own figure in full,
on the spot. `admin_confirm_cash_handover()` already existed and stamped `confirmed_by`, but
nothing downstream ever read that column, and no screen called the function at all.

**Fixed by changing what `my_cash_in_hand()` reports on, not by taking anything away from the
rep's side.** A rep's tap still records the claim, still cannot name an amount or a booking
set, and still stops that same cash from being grabbed by a second tap — but the money now
stays on the rep's own screen, visibly still theirs, until the boss confirms it through the
new **A12 · Cash** admin screen. Reported today's cash therefore splits into two amounts a rep
needs to tell apart, both still the rep's own money and neither a new category of aggregate
under §7:
- **what is still sitting with them** — `cash_handover_id is null` — grabbable by another tap;
- **what they already handed over but the boss has not yet confirmed.**

Almost always these are the same tap, once, at the end of the morning shift. They part ways
for the rare case this decision exists for: the morning batch sits with the boss awaiting
confirmation, then a night-shift pickup or a delayed payment reopens the first amount on top
of it, and a second, independent hand-over can be made without disturbing the first.

See `supabase/migrations/20260901093000_cash_confirmation.sql`,
`public.my_cash_ready_to_hand_over()`, and `public.admin_pending_cash_handovers()`.

## 32. A rep's PIN is their whole credential, and the boss can take an account away

The owner decided (1 Sep 2026) that reps should use a PIN as their only credential, with no
password step: a rep never sees or types a password, the boss issues the PIN when he creates
the account, and he can issue a new one whenever it is lost or overheard. He also asked to be
able to **remove** a rep's account, and for each rep to be placed at a specific hotel — the
second of which already existed (A8's home-hotel control, §8's isolation boundary) and was
verified rather than rebuilt.

The tradeoffs were put to him before this was built. What he chose costs the account a
high-entropy secret and gains it one credential a rep can actually hold in their head; the
things that make a six-digit PIN safe enough to be that credential are listed below, and none
of them are new — they were already carrying the PIN in its old role as the unlock gate.

### What was actually broken about the old shape

Nothing was insecure. It was that first use took two credentials and two screens to get one
rep into the app: a password long enough to be safe to generate (nineteen characters, read
aloud across a desk), typed once, only to be replaced immediately by a PIN the rep chose on
the next screen — after which the password was never used again but never stopped working.
The account therefore had two live credentials for the rest of its life, one of which
everybody had forgotten, and the weaker-looking one was the only one anybody used.

Collapsing that to one is not a weakening as long as the PIN keeps the protections the
password had. It does, and they are all pre-existing: argon2id at OWASP cost
(`src/lib/auth/pin.ts`), a rate limit of 8 attempts per 15 minutes **per address** on the
login action, and every failure written to the security log. That bucket caps one account at
roughly 768 guesses a day against a keyspace of a million — years to walk a meaningful
fraction of it, in the open, with the boss able to re-issue the moment anything looks wrong.

### The three decisions, and who made them

**1 · The PIN is minted by the server at account creation, never chosen.**
> `createRepAccount()` generates six digits from `crypto.randomInt` — not `Math.random`, not
> a birthday, not a pattern the boss would pick for a person he knows — hashes them and
> stores the hash through `public.set_pin_hash()`, which 0027 already made the only writer of
> that column. The plaintext is returned exactly once, to the screen that asked for it, and
> exists nowhere else afterwards. Re-issue (`reissueRepPin()`) is the same act, and is the
> only way a rep's PIN ever changes: rep-side self-service was taken away at the owner's own
> ask in 0027 and is not coming back through this door.
>
> The GoTrue account still gets a password, because `auth.admin.createUser()` requires one and
> there is no passwordless shape in the Admin API. It is CSPRNG junk that is never returned,
> logged or displayed, and re-issuing a PIN rotates it — otherwise "the old credential stops
> working" would be false for the accounts created before this decision, which were handed a
> real one.

**2 · One login field, and it accepts either credential.**
> *Asked:* whether to give reps their own PIN-shaped login screen, separate from the password
> one.
>
> *Chosen:* one field, tried as a password first and as a PIN second, labelled "PIN".
>
> *Why:* the accounts that predate this decision have real passwords, and the login screen is
> the last place to introduce a second door — §21's no-enumeration rule means the screen must
> answer identically for every address, and two doors is a way of asking which one an address
> belongs to. So the server tries both and says the same sentence either way: unknown address,
> wrong password, wrong PIN, deactivated account and "that address is the manager's" are one
> message. The `active` flag is examined only *after* a PIN verifies, for the same reason.
>
> A verified PIN also skips `/unlock`. It is the same PIN that screen would ask for, and
> asking for it twice in one sign-in is ceremony, not a second factor. `SetPinForm` stays as a
> fallback for a row whose `pin_hash` is somehow null, and should now never be reached.

**3 · "Remove this account" is deactivation, and the dialog says so.**
> *Asked:* the boss asked to delete a rep. A real `DELETE` is not available: `bookings.created_by`
> is `not null` with no cascade, so a rep with any history cannot leave the table — and the
> history is exactly what §8's cover-shift rule reads.
>
> *Chosen:* the button is named for what he wants ("Remove this account"), and the confirm
> dialog is where the screen is honest — access is suspended, the PIN stops working, the
> bookings stay, and he can give it back from the same page. Naming the button "Deactivate"
> would have answered a question he did not ask; letting the dialog imply a permanent deletion
> would have been a lie about what the button does.
>
> It gets `SignOutButton`'s confirm pattern — `alertdialog`, Escape and click-outside to
> close, and a confirm button that stays dead for three seconds — rather than the bare
> `confirm()` popup used for cancelling a booking or archiving a car. A rep at a hotel desk
> stops being able to work the moment this lands. Reactivating is the same server action with
> `active: 'true'` and gets no ceremony at all: it takes nothing away.

### The part that was genuinely hard to get right

A PIN sign-in calls no `supabase.auth.*` sign-in method, and the gate cookie is not a session
— `src/lib/auth/gate.ts` has always said so. `currentStaff()` asks `supabase.auth.getUser()`
through the caller's own cookies and then reads `profiles` through that same session so RLS
can see who is asking. Without a real Supabase session a rep would leave the login screen
holding a valid gate cookie, a bound device and no identity: `getUser()` returns null,
`requireStaff()` sends them back to `/login`, and the loop never breaks.

So the session is minted rather than presented. `mintSessionForEmail()` asks the GoTrue Admin
API for a magic-link token (`generateLink`, which issues one **without sending mail** — there
is still no SMTP on this project, client item 8) and redeems its `hashed_token` on the
request-scoped client, which writes the session cookies exactly as any other sign-in would.
The token is issued and spent inside one request, never travels and is never displayed, and
the whole path is unreachable without the service-role key — which was already the only key
that could read the PIN hash it is standing behind.

See `supabase/migrations/20260901120000_pin_only_signin.sql`,
`public.credential_lookup_for_email()`, `src/lib/auth/signin.ts` and
`src/app/(public)/login/actions.ts`.
