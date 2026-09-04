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

> **Narrowed by §42 (3 Sep 2026).** A location is still normally a hotel, but a booking
> may also start at the office (modelled as an ordinary hotel row) or at a hotel that
> isn't in the system (`bookings.adhoc_hotel_name`, free text).

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
- Pickups **08:30–11:30**, drop-offs **18:00–21:00**, both admin-configurable.
- **Pick-up is enforced.** A rep cannot record a pick-up outside the window
  at all. The **exception booking** flag is the only door through it, it
  requires a reason written beside it, and since §37 only the manager can
  record one — a rep who sends the flag has it dropped and then meets the
  window rule itself (IR116).
- **Drop-off stays a default, freely overridable** per booking, exactly as
  before. No exception flag is needed for it.
- Either time falling outside its window is still recorded on the booking via
  `window_override`, a fact the database derives — never a claim a rep or the
  admin can hand-set. The exception flag governs whether the write is
  *accepted*; `window_override` governs whether it is *remembered* as
  out-of-hours. A pick-up let through by the exception flag still stamps
  `window_override = true`.
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
  not yet **confirmed received by the boss** (see §31), with a "hand over" action. It counts
  **two streams** (§35): the rental cash they took at their own pickups, and the fuel money
  they took at the returns they processed — which are often somebody else's bookings, on a
  different day.
- No revenue history, no monthly totals, no averages, no company figures, no other rep's
  anything. **Not even indirectly** (no totals row, no counts that imply revenue, no
  "cars rented today" company-wide).
- **No commission** exists in this business. Do not build commission anywhere.

## 8. Cross-rep visibility — the hard rule

> **Narrowed by §42 (3 Sep 2026).** The cover-shift exception below does not extend to a
> booking at an unregistered hotel — there is no `hotel_reps` row for it to match against,
> so visibility for one of those is the creator and the admin only, by the owner's choice.

A rep looking at any car they do not have a booking on sees **occupied dates and nothing
else**. No rep name, no hotel, no customer, no times, no price, no reason.

A block placed by the admin (service, repair, write-off) is **visually identical** to
another rep's booking. This is deliberate.

**Exception:** a booking is visible to the rep who **created** it *and* to the rep assigned
to the **hotel** it belongs to. (Reps cover for each other; both need it in their history.)

## 9. Customer & driver data
Captured per booking:
- First name, last name — **never required**. See §33: neither blocks a booking on either
  creation screen, the same treatment R3b already gave them.
- **Hotel room number**
- **Phone**
- **Date of birth**
- Email — ~~optional, asked only at the signing step to send the contract copy~~ **superseded
  by §33 (1 Sep 2026): required at booking time, checked, and used to send the guest a
  confirmation immediately.** The signing-step field still exists and still works exactly as
  before — it now usually finds the address already filled in.
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
is recorded on the booking itself (`eligibility_override_by` / `_at`) and in the audit log.
It raises nothing for anybody to action — see §14. Minimum ages are admin-editable per
category — do not hard-code 21 and 23 in application logic.

## 12. Condition recording
- **Fuel level** out and in (eighths).
- **Damage marked on a car diagram at pickup**, tappable, with an optional photo per mark.
  That diagram is the car's agreed condition and is reproduced on the signed agreement.
  There is no diagram at return: damage found on a returning car is reported as an
  incident, in words and photographs (§14).
- **No odometer. No km. No mileage-based servicing.** Explicitly out of scope.
- Fuel policy is **same-to-same**.

## 13. Booking lifecycle
`Booked → Out → Returned`, plus `Cancelled` and `No-show`.
No quote stage. No settlement stage.

## 14. Anything non-standard goes to the boss
*(Rewritten 2 Sep 2026 — see §34 for what changed and why.)*

The rep **records the evidence and sends it**. They never price it, never argue it, never
collect it. That principle is unchanged; what it applies to has narrowed to the one case
that actually needs a person:

- **Damage, and anything else a rule did not anticipate** — a **free-form incident**: the rep
  picks the contract, writes what happened in their own words, attaches photographs, and
  sends it. It lands in the **admin incidents queue**, where the boss sets a charge and
  closes it. There is no type to choose.
- **A fuel shortfall is not sent to anybody.** It is arithmetic — €10 per missing eighth by
  default, an admin-set rate — applied by the database the moment a return is confirmed. It
  lands on `bookings.fuel_charge`, beside the total rather than inside it, so the figure on
  the signed agreement stays the figure that was signed. **The rep takes this money from the
  guest at the desk** and records what they took (§35) — it is the one charge in this
  section they do collect, because it is the one that is settled while the customer is still
  standing there.
- **A late return and a no-show raise nothing.** A rental that has not come back is one the
  booking's own status already says is out; a no-show is a status the boss sets on the
  booking.
- **An eligibility override raises nothing** (§11). Only the boss can make one, so a queue
  item would be him asking himself to look at what he had just done.

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
  seats, doors, tank size. **No A/C field** — every car has it (§36).
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
(by day / month / rep / category) with CSV export · incidents queue.

## 21. Auth
- **Admin:** email + one-time code. Concurrent desktop and mobile sessions allowed —
  signing in on one device must never sign out the other.
- **Reps:** email + password on first use, then **PIN or fingerprint** to reopen.
  Device-bound session. — **The password half is superseded; see §32.** A rep now signs in
  with their PIN and nothing else, and the boss issues it. The device binding, the
  shift-length unlock and the admin's own path above are unchanged.

## 22. Notifications
- **Admin:** incidents — whatever a rep has found and sent in.
- **Reps:** morning summary of their pickups, evening reminder of returns due.

> **Superseded by §36 (3 Sep 2026).** Push notifications are removed outright —
> settings UI, service worker, sender, schema and the three Railway cron
> services. The data these read (bookings, incidents) is untouched; only the
> "tell a phone about it" machinery is gone. See
> `supabase/migrations/20260903130000_drop_notifications.sql` and
> docs/07-SEASON-ROUTINE.md §1 for what replaced the crons' side effect of
> keeping the free-tier Supabase project awake.

## 23. Platform
**Android only.** A Next.js web app **wrapped as a Trusted Web Activity** and published to
the Play Store. The boss additionally uses it in a desktop browser.
**Online connection required** — with safe retention of an in-progress form if signal drops.

## 24. Language
Greek and English, switchable per user. Contract always bilingual.

That extends to data the admin translates, not just to interface text. `categories` holds
`name_el` and `name_en` side by side, and every screen but the category editor itself shows
whichever one matches the reader's own locale — `categoryName()` in
`src/lib/fleet/categories.ts`. The editor is the exception on purpose: it shows both,
because both are what it edits.

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
- ~~Invoicing, official receipts, myDATA e-invoicing, accounting integration~~
  **Reversed 3 Sep 2026 — see §43.** The owner asked for full ΑΑΔΕ connectivity, then
  established that what is needed is **ηλεκτρονική τιμολόγηση**, not merely διαβίβαση.
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
- ~~Which fuel charge rate applies — a per-litre figure or the boss's judgement each time?~~
  **Answered 2 Sep 2026:** a flat rate per missing eighth of a tank, €10 by default and
  admin-editable, applied automatically at return. See §14 and §34.

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
out to happen in practice, it wants an incident (§14) rather than a second signing path.

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
> — **The self-service half is superseded; see §38.** The owner asked for it back on 3 Sep,
> and a PIN issued here is now temporary: it gets the rep in once and is replaced by one they
> choose. Everything else in this decision stands, minting included, and §38 is built on it
> rather than around it — `set_pin_hash()` is still the only writer of the column.
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

## 33. Booking-time email, and exception bookings wait for the boss

1 Sep 2026. Two changes, made together because the second exists to cover the door the first
one needed to open.

**1. Email moves to booking time and becomes required.** §9 used to ask for it only at the
signing step, optionally, to send a copy of the agreement. The owner now wants it collected by
whichever rep takes the booking — over the desk or over the phone — checked before the booking
can be confirmed, and used to send the guest a confirmation there and then: pickup time, return
date, cost and the licence the category requires (age and years held, from `categories`). This
supersedes that half of §9; §16's signing-step field is untouched and now usually finds the
address already on the booking.

"Checked" is two things, both server-side, before the write: the address is a real shape
(`zod .email()`), and its domain can actually receive mail (`resolveMx`, `src/lib/email/
validate.ts`) — the failure a phone booking actually produces is a well-formed typo like
`@gmial.com`, not a malformed string, so format alone was not enough. Neither check runs on
every keystroke; both run once, at submit, the same posture as the returning-guest lookup's
own on-blur throttling (§25a).

**2. First and last name are never required**, on either creation screen. R3b (§30) already
made this call for the phone-booking screen: a rep given no name is not held up by it. R3's
form required them; that inconsistency is now closed the other way, toward the screen with the
guest actually optional.

**3. Exception bookings wait for the boss.** *(Superseded by §37 the following day: the rep
lost the tick-box, so the queue this section builds no longer exists. What survives is the
rest — email required and checked at booking time, and the exception flag waiving it.)*
Requiring email creates the same problem §5 already
solved for the pick-up window: sometimes the normal rule cannot be met and the booking still
has to happen. The existing "exception booking" checkbox is the answer to both — ticking it
already waives the pick-up window; it now also waives every other requirement on the form,
email included. Nothing on either creation screen is mandatory once it is checked.

What is new is what ticking it now costs. An exception booking used to go live immediately,
identical to an ordinary one, the moment it was written. The owner does not want that: a
half-checked booking — an unverified email, or a guest arriving well outside the pick-up window
— should not act like an ordinary one anywhere else in the app until someone has actually looked
at it. So it now starts in `bookings.exception_status = 'pending'` and stays there until the boss
acts on it, in a new queue at `/admin/exception-bookings`:

- **The car is still held.** `pending` sits inside the same `status = 'booked'` the exclusion
  constraint and `availability()` already key off — nothing about how the car is reserved
  changes. This was the one non-negotiable part of the design: two reps racing for the same car
  is a worse failure mode than a rep waiting on approval.
- **It is invisible to the rest of the day.** Filtered out of Today, the movements sheet and the
  push digests (`rep_day_movements()`) — a rep is not told to go pick up a car the boss has not
  looked at yet.
- **It cannot be picked up.** A hard block on the booked → out transition, in the database,
  beside the eligibility one it now sits next to — no UI path around it, admin included.
- **It only leaves 'pending' through the boss.** Two admin-only RPCs,
  `admin_approve_exception_booking()` and `admin_deny_exception_booking()`. Approving clears it
  to run exactly like an ordinary booking — including sending the confirmation email that was
  withheld at creation, now that there is something to confirm. Denying cancels it outright,
  which is what actually frees the car: `pending` never held it on its own, `status = 'booked'`
  did, and cancelling is the one existing state every rep already reads as "this did not
  happen."

See `supabase/migrations/20260901150000_booking_exception_approval.sql`,
`src/lib/email/validate.ts`, `src/lib/email/booking-confirmation.ts`,
`src/lib/bookings/confirmation.ts` and `src/app/(app)/admin/exception-bookings/`.

## 34. Exceptions become incidents, and fuel becomes arithmetic

The owner's ask, 2 Sep 2026, prompted by nothing more than the sidebar: **Exceptions** and
**Exception bookings** sat next to each other and read as the same thing twice. They are not
related at all — one is a queue of problems on rentals already underway, the other the boss's
approval gate for new bookings that broke a rule (§33) — but looking at why they were
confusable showed that the first was mostly not earning its place.

§14 had six exception types. Four of them were not doing the work:

- `late_return` and `no_show` were **dead**. Nothing in the app ever created either one; they
  existed as values in an enum and an option in a filter. A rental that has not come back is
  one the booking's own status already reports.
- `fuel_short` was **arithmetic wearing the clothes of a judgement**. The owner's rule is a
  flat rate per missing eighth of a tank, so the queue item asked the boss to look at two
  gauge readings and type in their product.
- `eligibility_override` was **the boss logging his own act back to himself**, and then being
  pushed a notification about it. It had also been misread — including by us — as something a
  rep could do. A rep never could: the block is `app.assert_drivers_eligible()` on the
  booked → out transition, and the only door around it asserts admin.

What was left was damage — the one case where somebody genuinely has to look at the thing and
decide — and it was the worst served of the six, because it was raised **automatically from
taps on a car diagram**. A cracked wing mirror is described in a sentence and a photograph,
not inferred from a dot on an outline.

**So the taxonomy is gone.** One free-form record: pick the contract, write plain words,
attach photographs, send. No type, no dropdown, nothing to classify. The boss reads it, sets a
charge, writes what he decided and closes it — the half of §14 that was always right and is
unchanged.

Three consequences worth stating, because each one is a decision rather than a detail:

- **The fuel charge does not touch `total`.** It lands on `bookings.fuel_charge` and is shown
  beside the price. `total` is the number on the agreement the guest signed and reproduced in
  the contract PDF; growing it afterwards would make the record disagree with the paper.
- **The return flow lost its damage diagram.** Its only consumer was the flag it raised. The
  *pickup* diagram stays and is untouched — that one is the car's agreed condition and goes
  onto the signed agreement (§12).
- **The rate is a setting, not a constant.** Fuel prices change without the app changing.
  `app_settings.fuel_charge_per_eighth`, €10 by default, on A10.

`/admin/exception-bookings` keeps its name and is untouched throughout, which is what makes
the sidebar readable again: **Incidents** and **Exception bookings** are now plainly two
different things.

See `supabase/migrations/20260902100000_incidents.sql`,
`src/app/(app)/incidents/` and `src/app/(app)/admin/incidents/`.

**Operational note.** Applied to the project and to Railway on 2 Sep 2026: the migration is
live, and the cron service that sweeps the boss's inbox now runs
`npm run notify -- --incidents` (the old `--exceptions` flag no longer exists). The service is
still named `notify-exceptions` in Railway, which is cosmetic. See docs/07-SEASON-ROUTINE.md
§1, which also corrects a schedule this repo had recorded wrongly.

> **Overtaken by §36 (3 Sep 2026).** There is no inbox sweeper any more: push
> notifications went entirely, `npm run notify` with it, and the
> `notify-exceptions` service was deleted along with `notify-morning` and
> `notify-evening`. The incidents themselves are untouched — the boss reads them
> on the screen. What used to be this cron's incidental side effect, keeping the
> free-tier Supabase project awake, is now the whole job of a service called
> `keep-alive`. See docs/07-SEASON-ROUTINE.md §1.
## 35. The rep takes the fuel money, so the app counts it

§34 made the fuel shortfall a real charge and stopped there: the figure was computed and
displayed, and nothing could record that anybody had paid it. The owner answered the question
that decides it (2 Sep 2026): **yes, a rep does take the fuel money from customers**, in cash,
at the desk, when the car comes back.

That makes it cash, and cash is not just a number on a booking here. §7 gives a rep exactly one
aggregate — today's own cash in hand — and §31 makes the boss's confirmation what clears it.
Fuel money the app did not know about would be money a rep is holding that never appears in
that figure and is never handed over: the reconciliation goes quietly wrong, which is worse
than not collecting it at all.

**It is recorded on the return handover, not on the booking.** That is the whole design, and
it is not where the rental money lives. Rental cash is a fact about a booking —
`bookings.collected`, taken by `created_by` at the pickup. Fuel cash is a fact about an
*event*, and the row describing that event already carries the two things this needs and the
booking does not:

- **Whose it is.** `handovers.by_profile` — the rep who processed the return, which is
  routinely not the rep who made the booking. Reps cover for each other (§8) and the guest
  hands the keys to whoever is on the desk.
- **Which day it is.** `handovers.occurred_at` — a rental picked up on Monday can come back on
  Friday. Its rental cash is Monday's; its fuel cash is Friday's.

**What the rep records is what they actually took**, not what was owed. The amount is
pre-filled with the charge and stays editable, and may be less, or nothing. A guest who argued
it down is a fact for the boss to see — both figures sit side by side on A5 — rather than a
state the app refuses to record. §14's rule that a rep never *prices* anything is untouched:
the price is the database's, and the rep only says what crossed the desk.

One hand-over still covers everything. `my_hand_over_cash()` sweeps both streams into a single
`cash_handovers` row, because it is one envelope going across one desk; what makes them two
columns is which day and which rep each was earned by, not that they travel separately.

**A grant had to be narrowed to make this safe.** 0011 gave `authenticated` a table-level
UPDATE on `handovers`, which was survivable while a handover held a fuel reading and some
notes. It is not survivable once `by_profile` and `occurred_at` decide whose cash a payment is
and which day it belongs to: a rep could have re-attributed their takings to a colleague, or
moved them to a day the boss had already settled. The grant is now column-by-column, and a
trigger settles `by_profile` at insert from `auth.uid()` for anyone who is not the boss.

Not built, and deliberately: **incident charges still cannot be collected** (§14). §15 takes no
deposit and there is no card on file, so a guest who has flown home cannot be charged at all —
the boss's queue records what a thing cost, not a payment. If that ever changes, this pair of
columns becomes a payments ledger; building one now on the strength of a case that does not
exist would be building it twice.

See `supabase/migrations/20260902110000_fuel_payment.sql`,
`src/app/(app)/bookings/[id]/return/` and `tests/db/rep-cash.test.ts`.

## 36. The availability filters ask the two questions a guest actually asks

> **Superseded by §39 (3 Sep 2026).** Both remaining filters are gone: grouping the results by
> model with a count against each answers seats and gearbox by being read. The reasoning below
> stands as the record of how four became two, and `SEAT_CHOICES` / `matchesSeatChoice()` no
> longer exist.

R2 shipped with four filters — category, transmission, seats, A/C — which was the fleet's
data model handed to the rep as a form. The owner cut it to two (2 Sep 2026), and each cut
is a different kind of decision.

**A/C is gone because it was never a question.** `car_models.aircon` had been `not null
default true` since 0003 and no row ever said otherwise: every car in this fleet has air
conditioning. A checkbox whose only effect is to narrow the fleet to itself teaches a rep
that ticking boxes does nothing. The column is dropped rather than left defaulted — a column
that exists invites a false row, and if a car without A/C is ever bought this comes back as
a deliberate migration with the screens behind it (0032).

**Category is gone from the FORM, not from the screen.** The results are still grouped under
their category headings, because category is what drives price and the age/licence gate and
the rep needs to see it. But nobody walks up to the desk and asks for a Category D. They ask
for something small, or something automatic, or something that fits seven people; the rep
translating that into a letter before they can search is the app making them do its work.

**Seats became three buttons, and `7` means seven or more.** "Minimum seats" as a number
field asked the rep for a number nobody says out loud, and answered `4` with the entire
fleet. The three choices are the three real ones — 4, 5, 7+ — and the last of them is a
range on purpose: the vans here seat eight and nine, and a guest asking for seven seats
means any of them. `4` and `5` stay exact. Offering a five-seater to someone who asked for
four is a bigger car at a bigger price, and that is the rep's offer to make out loud, not
the filter's to make silently.

See `supabase/migrations/20260902120000_no_aircon_flag.sql`,
`src/lib/availability/types.ts` (`SEAT_CHOICES`, `matchesSeatChoice`),
`src/app/(app)/availability/` and `tests/unit/availability-filters.test.ts`.

## 37. The exception is the boss's, and the queue it needed is gone

2 Sep 2026, the same day as §34–§36. §5 gave a rep an escape hatch out of the pick-up
window. §33 widened that same tick-box to waive the newly-required email as well and —
because a rep was the one ticking it — parked what came out in an approval queue at
`/admin/exception-bookings`. The owner's decision reverses the first half, and that deletes
the second: **only the manager can make an exception booking.**

The queue existed for one reason, which was that somebody had to look at what somebody else
had waved through. Once the person ticking the box is the person who would approve it, the
whole apparatus — a `pending` state, two RPCs, a hard block on pickup, a screen, and a
confirmation email held back until it cleared — stands between the boss and a booking he
made deliberately. So it is gone, and an exception booking is live the moment it is written,
like every other booking.

- **A rep now meets the rule instead of the door.** An out-of-window pick-up is refused with
  IR116 — "pick-ups are 08:30–11:30" — which was always the true answer; the hatch was what
  let them past it. Email is likewise simply required: the "or tick exception and book
  without it" half of that error message is gone, because for a rep it no longer exists.
- **The flag is taken away in the database, not on the screen.** The tick-box is only
  rendered for an admin and the server action checks the role, but neither is what enforces
  it: `app.bookings_before_write()` forces `pickup_exception = false` on any non-admin
  INSERT and carries both columns forward from `old` on any non-admin UPDATE. That is how
  every other privileged field on this table is handled (`total`, `block_reason`,
  `period_id`) and it is the only way that works here — the column grants are to
  `authenticated`, which is the admin too, so revoking them would take the boss's own write
  with it. A rep can neither tick the box, untick the boss's, nor keep an exception alive by
  moving the time.
- **What the boss gets is unchanged, minus the wait.** He ticks it, writes the reason (still
  required by 0027's CHECK), and nothing on the form is mandatory after that — email
  included. The booking holds the car, appears on Today and the movements sheet, sends its
  confirmation immediately, and can be picked up.
- **The known cost is the afternoon walk-in.** R4b (§30 decision 3) defaults a walk-in's
  pick-up to *now*, and "now" is outside 08:30–11:30 for most of the working day. A rep
  taking a walk-in at 15:00 used to tick the exception box; now the time field is bounded to
  the window and the write is refused (IR116). This is not a regression this decision
  introduced so much as one it makes visible — under §33 the same rep ticked the box, got a
  `pending` booking, was sent straight into licence capture by `next="pickup"`, and was
  stopped there by the approval block. The failure simply moves to the start, where it can
  be read. There are two ways out, both the owner's to choose — **widen the pick-up window
  on A10**, which is a setting and needs no code (08:30–20:00 would cover the desk's whole
  day and leave the rule doing its real job of refusing 03:00 bookings), or exempt the
  walk-in path from the window, which is a new rule and a migration. Neither has been
  assumed; the decision above is implemented as given.

See `supabase/migrations/20260902130000_admin_only_exceptions.sql`,
`src/app/(app)/bookings/new/`, `src/app/(app)/bookings/confirm/`,
`src/app/(app)/contracts/new/walk-in/page.tsx` and
`tests/db/exception-bookings.test.ts`. Deleted: `src/app/(app)/admin/exception-bookings/`,
`bookings.exception_status`, `admin_approve_exception_booking()`,
`admin_deny_exception_booking()`, `admin_pending_exception_bookings()` and IR123.

## 38. The rep chooses their own PIN, and one the boss issued is temporary

3 Sep 2026. The owner has asked for the opposite of what he asked for on 1 Sep: **a rep
changes their own PIN again.** §32 decision 1 said self-service "is not coming back through
this door"; it comes back through this one. That paragraph is superseded on this point
alone — everything else in §32 stands, and the mechanism below is the one §32 built.

On top of the plain reversal he asked for the prompt to be **unavoidable and repeating**: a
rep who signs in with a PIN the boss generated is sent to a change-PIN screen before they can
reach any part of the app, and sent there again at every sign-in until they have actually
replaced it.

### Why the reversal is right, which is not the same as why it was asked for

§32 wrote the cost of the old shape down honestly — "the boss knows the initial PIN" — and
answered it with authority: he is the owner, he has admin rights over every row, and the
audit log names the actor on every write. That answer is true and it is about the wrong
thing. Authority is not the question a credential answers. `bookings.created_by`, every
`audit_log.actor_id`, the cash ledger and §8's whole isolation boundary are claims about
**which person** did something, and a secret two people hold cannot support a claim about
one of them. Not because the boss would forge a booking — because after the fact there is no
longer any way to say that he could not have.

So the generated PIN keeps doing the job it is good at and stops doing the one it never
could. It is a **handover token**: minted by the server, read off a screen, good for getting
one rep in one time. What it is not, from now on, is the thing that identifies them.

### The decisions

**1 · Full self-service, not first-use only.**
> *Asked:* whether to unlock the change screen only for a rep still holding a boss-issued
> PIN — the narrow fix the request literally needed — or generally.
>
> *Chosen:* generally. `/change-pin` is on the settings screen for a rep who has already
> chosen one, and R8 (docs/04-SCREENS.md) listed a PIN section from the start.
>
> *Why:* the narrow version answers "the boss knows this one" and leaves "somebody watched me
> type it at the desk" with no answer but asking the boss for a re-issue — which hands the
> new PIN to a second person again. A rep who thinks their PIN was overheard should be able
> to fix it in ten seconds without telling anyone, and that is a different act from the
> forced one only in who initiated it.

**2 · The current PIN is required, including on the forced screen.**
> *Asked:* whether to skip the "current PIN" field on the forced first use, where the rep
> typed that PIN into the login screen seconds earlier and §32 objected to exactly this kind
> of second ask.
>
> *Chosen:* required, both ways, one form.
>
> *Why:* §32's objection was to a second **credential** — a password in front of a PIN, two
> secrets for one door. This is one secret, asked for at the moment it is replaced. And the
> screen is reachable for as long as the shift-length unlock window is open, on a phone that
> lies on a hotel front desk: without the field, walking past an unattended unlocked phone is
> enough to take the account, and the rep is then locked out behind a PIN a stranger chose.
> The field costs six digits once per PIN and closes that outright.

**3 · A chosen PIN is exactly six digits, and predictable ones are refused.**
> *Asked:* nothing — this is the part of the reversal that had to be designed rather than
> decided, because it is what the reversal actually costs.
>
> Every PIN in this system until now came out of `crypto.randomInt`, so §32's arithmetic —
> ~768 guesses a day against a keyspace of a million, years to walk a meaningful fraction —
> was a fact about the PIN and not a hope. A PIN a person picks is not uniform over that
> million. An attacker does not walk a keyspace in order; they try the few hundred strings
> people actually choose.
>
> So `isChosenPinLength()` holds the length at six — a rep who could pick four digits would
> cut the keyspace to ten thousand, which the same rate limit walks in under a fortnight —
> and `isPredictablePin()` refuses repeated blocks (`111111`, `121212`, `123123`), runs up
> and down (`123456`, `654321`), and the short list of leaked favourites the first two rules
> miss. It is not a strength meter and does not pretend to be one: it cannot know a rep chose
> their year of birth and does not try. It removes the strings that would otherwise be tried
> first, which is the part worth doing and the most that can be done without asking someone
> at a desk to memorise something they will write on a sticky note instead.

### What was deliberately not built

**No new door in the database.** `public.set_pin_hash()` is still the only writer of
`pin_hash`, still SECURITY DEFINER, still `service_role` only, and
`app.profiles_before_write()` still refuses a `pin_hash` write from any caller with an
`auth.uid()` — the raw-PostgREST gap 0027 closed stays closed. The rep gets no grant, no
policy and no RPC of their own: `changePin()` authenticates them in Node, argon2-hashes what
they typed, and calls the same function the boss's re-issue calls with the other answer to
`p_boss_issued`. Nothing new is reachable from a browser holding the anon key.

**The prompt is a redirect, not a permission.** `requireUnlocked()` sends a rep with
`pin_must_change` to `/change-pin` before any screen behind `(app)/layout.tsx`, which is what
makes it unavoidable in practice. It is not a privilege boundary and is not written as one — a
rep who somehow got past it would be no more privileged than one who did not, only still
carrying a credential the boss also knows, which is the state the whole path exists to end.
What *is* enforced in the database is that the flag cannot be cleared without the PIN actually
changing: `pin_must_change` is in no client grant, the guard restores it from `old` on any
write with an `auth.uid()`, and `set_pin_hash()` writes hash and flag in one statement, so
dismissing the prompt and replacing the PIN are one act.

**Existing reps are not exempt.** The migration backfills `pin_must_change = true` for every
rep already holding a PIN, because every one of those came from the boss. The pilot has not
started (§32's October date), so this is a handful of rows, and the alternative was a set of
accounts permanently excused from the rule on the grounds that they predate it.

**A re-issue re-arms it.** A PIN the boss generates because one was lost or overheard has
been read aloud too, so `reissueRepPin()` passes `p_boss_issued: true` exactly as account
creation does, and the rep goes through the screen again. That is the point rather than a
side effect.

**Sessions are not reset on a change.** CLAUDE.md's "reset sessions on password change" has
nothing to reset here: a rep is bound to one device (§1), so there is no second session to
invalidate, and the person changing the PIN is the person holding that device. The unlock
window is re-opened rather than closed, because they proved the old PIN and chose the new one
in the same request and sending them to `/unlock` to type what they just set is ceremony.

**The login field still accepts four to eight digits.** `isWellFormedPin()` is the reader and
is unchanged: accounts issued a PIN under the old rules must still be able to sign in, and
narrowing the reader would lock them out on the way to the screen that fixes it.

See `supabase/migrations/20260903100000_rep_chooses_own_pin.sql`, `src/app/change-pin/`,
`src/lib/auth/pin.ts`, `src/lib/auth/session.ts`, `src/lib/users/accounts.ts`,
`tests/unit/pin-rules.test.ts` and `tests/db/admin-users.test.ts`.

## 39. Availability counts models, not plates — and the filters go with the form

R2 listed every plate: six near-identical Fiat Pandas in a row, roughly a hundred rows for
this fleet, each with a free/occupied badge. That is the fleet's data model handed to the rep
as a list, and it answers a question nobody asks. A guest asks for a Panda; the rep needs to
know whether there is one and how many are left, and only then which one.

**The screen is now a visual list of MODELS**, grouped under their group heading, each card
carrying the model's photo and `n of m free` for the chosen dates. Cards run left to right,
two to a line on a phone, wrapping onto the next line rather than scrolling sideways: with
eight groups a shelf would be eight separate swipe gestures, and a model off the right-hand
edge is a model the rep does not know they have.

**A model with nothing free greys out and keeps its place.** It is not hidden and it is not
sorted to the bottom, because the shape of a group has to be the same every time the rep
opens it — and because "no Pandas, but I have a Yaris" is the sentence the screen exists to
support. The greying is never the only signal: the card also says *None free* in words, since
colour alone fails WCAG 1.4.1 and fails a rep in August sunlight for the same practical reason.

**Free means free for the WHOLE range.** One booking row holds one car for the whole rental
(docs/06-IMPLEMENTATION-NOTES.md), so a plate free for five days of a six-day search is not an
offer the rep can make. Counting it would put a number on screen that the confirm step then
refuses, in front of the guest.

**`Book` names the first free plate**, because a booking commits one `car_id` and which of six
identical Pandas the guest gets is not a decision anyone makes at that point in the
conversation. The rep who does care opens `Plates` on the card and picks one.

**This leaks nothing §8 forbids.** A count of free plates is derived from exactly the occupied
dates `availability()` already returns. It carries no rep, no customer, no reason and no
times; an admin's service block and another rep's booking both simply fail to be free, which
is what §8 requires them to look like.

**The two filters are gone, and the submit button with them.** §36 cut four filters to two —
seats and transmission — on the grounds that they were the two questions a guest actually
asks. Grouping by model with a count against each answers both by being read: the seat count
is on every card, the gearbox is on every card, and the fleet is now sixteen cards rather than
a hundred rows, so narrowing it before looking at it stopped being how anyone reads the
screen. `SEAT_CHOICES`, `isSeatChoice()` and `matchesSeatChoice()` are deleted rather than left
unused — they had no other caller.

**The dates stay, and they auto-load.** Availability is not defined without a range, so the
two date fields remain — but there is no `Show` button. A guest asks "what about the week
after?", and that should cost one tap on a date, not a tap and then a hunt for the button that
makes the tap count. The change is debounced (a desktop date input fires `change` as each part
is typed, so `2026-07-01` arrives via a year of `0002`), it refuses to navigate to an end
before a start, and it still navigates rather than holding state — so the range lives in the
URL and back, refresh and a pasted link all behave, which is what the old GET form was for.
A `<noscript>` submit button keeps the screen working without JavaScript.

See `supabase/migrations/20260903120000_model_photos_and_engine.sql`,
`src/lib/availability/types.ts` (`groupFleet`), `src/lib/storage/fleet-photos.ts`,
`src/app/(app)/availability/` and `tests/unit/availability-filters.test.ts`.

## 40. Models move to the fleet, groups stay in settings — and a category is now a "group"

Two halves of A3 that had always been one screen, split by what they actually are.

**A model is part of the fleet**, so it is created and edited on the fleet screen, beside the
plates that belong to it. The screen already grouped cars by model; it now has two doors above
that list — `Add a car model` and `Add a plate` — and an `Edit model` disclosure on each model
heading. A plate has always required a model (the select is `required`), and the order the two
buttons sit in says which comes first.

**A group is a pricing and eligibility band** — what a category costs, how old its driver must
be — which the boss sets once a season. That belongs with the rest of the settings, and it
stayed in `admin/settings/CategoriesSection.tsx` when the models left it.

**A new model must have a photo.** R2 is a visual list and a model without a picture is a hole
in it. Editing an existing model does not require one, which is not an inconsistency: an empty
file input on an edit means *leave the picture alone*, and the seeded placeholder models
predate the bucket and have to stay editable — including to add the photo they lack.

**`car_models` gains `engine_cc` and `horsepower`**, both nullable. They are the two specs a
guest asks unprompted at the desk and the two the table did not carry. Nullable because an
electric model has no cc, and because a model whose brochure figure nobody has looked up yet
still has to be saveable — a model that cannot be added until someone finds its tank size is a
model that gets added to the fleet as a sticky note instead.

**"Category" is now "group" in the interface, and only in the interface.** It is the term the
rental trade uses and the term the client uses. The table, the columns, the policies and the
code are still `categories`: renaming them would touch the RLS policies, the guard triggers,
`price_rows`, the audit log and every screen at once, to no one's benefit. The rename lives in
`messages/*.json`. In Greek the swap is `κατηγορία → ομάδα`, which is grammatically free —
both nouns are feminine, so every article and adjective around them is unchanged. One string
is deliberately exempt: `pickup.licenceBackHint` speaks of the categories on a *driving
licence*, which are not car groups.

See `src/app/(app)/admin/fleet/ModelForm.tsx`, `src/app/(app)/admin/fleet/model-actions.ts`,
`src/app/(app)/admin/settings/CategoriesSection.tsx` and `messages/`.

## 41. The admin ledger gets one search bar, and the ledger gains an email column

Asked ahead of the first season's end, with ~7,000 customers expected in the ledger by
then: a "robust" search over name, phone, email and "whatever else makes sense", in one bar.
Three things followed from what §25a had already decided, and were put to the owner rather
than assumed.

**Admin-only, and unchanged for reps.** §25a already made the Ψηφιακό πελατολόγιο admin-only
— a rep's entire access stays `customer_by_phone()`: exact number, one row, rate limited,
logged. This search is a new way for the admin to read a table they could already read in
full; it opens no new door and `customer_by_phone()`'s return columns are untouched.

**`customers.email` is new.** The ledger never stored it — only `bookings.cust_email`
(optional, §9/§33) did, and only on the booking. *Chosen:* add `email` to the ledger,
captured on the same consent and the same manual-only retention as every other field
(§25a §§1–2), because a search bar that cannot search a field nobody kept would not be
robust. It is populated two ways: `record_customer_consent()` reads whatever
`bookings.cust_email` already holds at signing, and — because §33 lets the guest give it
later, at the separate "email me a copy" step, which never re-runs consent —
`app.customers_refresh_email_from_booking()` (a trigger on `bookings.cust_email`, the same
shape as `app.customers_refresh_from_driver()` two migrations up) carries a later or
corrected address across. Both paths coalesce the way name, dob and licence already do:
never overwritten with a null, most recent rental wins.

**One generated column, not a four-column `.or()`.** `customers.search_text` is `first_name
|| last_name || phone_e164 || email || licence_number`, lower-cased, generated and stored —
the device `bookings.cust_phone_e164` already uses, for the same reason: a value every write
produces on its own. One `pg_trgm` GIN index on it is what the bar matches against, so name,
phone, email and licence number are one predicate and one index rather than three or four,
and a field added to the bar later is a column in the generated expression, not a new clause
in every query that searches it. Licence number was added to the match set on the same
reasoning as email: it is already on every ledger row and is the natural lookup when a guest
hands a rep — or the boss — their licence.

**The bar moved, and stopped being erasure-only.** The screen used to have one search box,
under the status figures, whose only purpose was finding a guest to erase
(`LedgerErasureForm`). It is now `LedgerSearchForm`, above the status figures — the first
thing on the screen, because looking someone up is the common case and erasing them is not
— and results show enough (name, phone, email, licence number, last seen, whether photos are
held) to tell two similarly-named guests apart before erasing is even in question. Erasing
stays one action a result offers, not the reason the bar exists.

See `supabase/migrations/20260903150000_ledger_search.sql`,
`src/app/(app)/admin/customers/actions.ts`, `src/app/(app)/admin/customers/LedgerForms.tsx`,
`src/app/(app)/admin/customers/page.tsx` and `tests/db/customers.test.ts`.

## 42. A booking may also start at the office, or at a hotel not in the system

The business rents cars from three kinds of place, not one: a base at each registered
hotel (§3's original picture), the company's own office, and — on occasion — a guest's
hotel that was never entered here. §3 said "a location is a hotel" as a flat rule; this
narrows it rather than overturning it, because the two new cases needed different
treatment from each other, not just from the old one.

**The office is a hotel row, deliberately.** §3 already ties a location to two things: a
display name and, through `hotel_reps` (§8's cover-shift exception), who may see the
booking besides its creator. An office with real staff wants both, so it gets both for
free by being an ordinary `hotels` row — "Company Office" or whatever name is decided —
with real `hotel_reps` assignments. Nothing in the schema, the booking forms, the RLS
policies or the contract renderer treats a hotel specially by name, so this needed no
migration and no code change: it is an action for the admin to take through the existing
`/admin/hotels` and `/admin/users` screens, not a build item.

**An unregistered hotel is not worth a permanent row**, and has no rep stationed at it, so
it gets a free-text column instead: `bookings.adhoc_hotel_name`. A booking names a
registered hotel or types one that isn't in the system — never both, enforced by
`bookings_hotel_xor_adhoc` — and the rep-facing forms present this as one field that
toggles between a `<select>` and a text input (`HotelLocationField`), matching how the
choice is actually made at the desk.

**§8's cover-shift exception does not extend to an unregistered hotel — the owner's own
call, put to him directly rather than assumed.** A booking with no `hotel_id` has nothing
for `hotel_reps` to match, so `bookings_select`/`bookings_update`
(`20260830091100_rls.sql`) already fall back to `created_by = auth.uid()` with no RLS
change at all: visibility is the creator and the admin, and nobody else. If a second rep
ever needs to help with one of these, that is a case for the admin to reassign or handle
directly, not a standing mechanism — asked and declined, not overlooked.

See `supabase/migrations/20260903140000_adhoc_hotel.sql`, `src/components/HotelLocationField.tsx`,
`src/app/(app)/bookings/new/actions.ts`, `src/lib/bookings/quick.ts`,
`src/app/(app)/bookings/actions.ts`, `src/app/(app)/admin/bookings/actions.ts` and
`tests/db/isolation.test.ts`.

## 43. ΑΑΔΕ: e-invoicing, not transmission — and it is three obligations, not one

The owner asked for full myDATA connectivity on 3 Sep 2026, reversing §26. His own opening
instruction was that data should reach ΑΑΔΕ **at the end of the day rather than live, so a
rep's mistake can be corrected before it leaves the building**. That instinct was right for
the model he had in mind and is largely overtaken by what the answers turned out to be. The
reasoning is kept here because it is the reason several things are shaped as they are.

### The distinction the whole section turns on

**Διαβίβαση** is issuing a document yourself and then reporting its data to myDATA.
Self-transmission through the REST API is permitted, and the ERP channel's deadline is the
next day after issuance (Α.1138/2020 as amended by Α.1090/2022). That is the model the
first draft of this work assumed.

**Ηλεκτρονική τιμολόγηση** is the document itself being *issued* electronically, sealed,
and stamped with the ΜΑΡΚ and QR. Under the mandatory B2B regime that happens through a
certified **Πάροχος Υπηρεσιών Ηλεκτρονικής Έκδοσης** or through ΑΑΔΕ's free applications. A
self-built issuer is an accepted channel only during the transition, which ends 31.12.2026.
This app goes live 1 March 2027, so it is past it.

**The app is therefore never the issuer.** It is a source system that hands data to a
provider and takes back the ΜΑΡΚ, the seal, the QR and the finished document. Everything
that would have been ours — building XML against the myDATA XSD, `SendInvoices`, MARK
handling, `CancelInvoice`, reconciliation via `RequestTransmittedDocs` — belongs to the
provider instead.

### Three separate obligations, and only one of them is ours

| | Who does it | Timing |
|---|---|---|
| **Retail receipts (λιανική)** | The ταμειακή/ΦΗΜ, at the desk | At the transaction |
| **B2B invoices** | A certified Πάροχος | Sent by us, issued by them |
| **Ψηφιακό Πελατολόγιο** | **Us, directly** | Real time, both ends |

The third is the only one this app performs itself, it needs no provider, and it is the one
already carrying a live penalty (§43.3).

### The answers, and what they did to the design

Given by the owner between 3 and 5 Sep 2026. Numbering is the questionnaire's
(`src/lib/accountant/questionnaire.ts`).

1. **The accountant already transmits to myDATA, through Epsilon.** So the app must never
   also transmit the same income, or it lands twice and the pre-filled VAT return is wrong.
   Under the provider model this resolves cleanly, but the accountant's current
   transmission of these documents has to stop the day the app goes live. That is a written
   agreement to obtain, not code.
2. **Retail receipts come from a ταμειακή, and it "goes through Epsilon."** With answer 5
   below, this is the finding that restructured everything: **over 95% of documents never
   touch a provider at all.** They are cut on the register and transmitted by it via ΕΣΕΝΔ.
3. **The Ψηφιακό Πελατολόγιο is already being kept.** So the app takes over an existing
   practice rather than starting one, and the manual entry must stop the same day.
5. **Under 5% of turnover is invoiced B2B.** The e-invoicing work serves that slice.
6. **2023 revenue was under €1,000,000**, so the business falls in the second phase:
   mandatory 1.10.2026, transition to 31.12.2026.
10. **Issue date is the handover, and the VAT period is the month the handover falls in.**
    A car handed over 31 January and returned 3 February belongs to January.
11. **Cash and card only. No bank transfers.** `bookings.pay_method` still carries a
    `transfer` value that is now dead and should come out.
13. **Damage is settled directly with the insurer**, so the customer is not charged and
    there is nothing to invoice. This confirms §35's "incident charges cannot be collected"
    rather than reversing it.
14. **A document exists only if the customer turns up.** No handover, no document, ever.
15. No limit from the owner beyond whatever ΑΑΔΕ requires.
16. **One registered installation: the main office.** The hotels are not establishments.
17. Credentials undecided.

### What the ταμειακή answer cost, and what it saved

**The end-of-day batching design does not survive for retail, and that is most of the
volume.** A ΦΗΜ receipt is issued at the transaction, printed, handed over. There is no
draft to hold and nothing to batch. The owner's original worry — a rep making a mistake
that has already reached ΑΑΔΕ — is now handled by the register's own void procedure, which
is ordinary retail practice and not ours to build. The draft-then-issue design survives only
for the B2B slice.

**One registered installation is worth more than it looks.** `branch` becomes a single
constant (0, the έδρα, to be confirmed by the accountant) rather than a lookup per hotel.
And because the hotels are off-site, the Ψηφιακό Πελατολόγιο's own
`isDiffVehPickupLocation` / `vehiclePickupLocation` fields — and their return-side
counterparts — are exactly the right shape for a business that hands cars over at hotels.
The app already knows the hotel for every booking, including §42's unregistered ones, so
nothing new is captured for this.

**A new burden lands at the desk, though.** *(Lifted 4 Sep 2026 — see §44. Under the
provider path the app receives the ΜΑΡΚ itself and none of the following applies.)*
`ClientCorrelations` links a registry entry to
its document by either a ΜΑΡΚ or ΦΗΜ details (`FIMNumber`, `FIMAA`, `FIMIssueDate`,
`FIMIssueTime`). On the ΦΗΜ path that means **the receipt number has to get off the register
and into the app at handover**. That is a new field and a new step for a rep with a guest
waiting, and it is not optional if the registry entries are to correlate.

### Fuel: tracked internally, never invoiced by us

Answer 13's first half needed a second pass, because "leave fuel out of the system" reads
two ways and an app cannot implement "mostly". Settled by the owner 5 Sep 2026: **stop
issuing a tax document for fuel, keep tracking the cash internally.**

So §34 and §35 stand entirely unchanged. `handovers` keeps its fuel payment columns,
`my_cash_in_hand()` keeps sweeping both streams, and the reconciliation reasoning in §35 —
money a rep holds that the app does not know about goes quietly missing — is untouched. The
only consequence is negative: **no fuel document is ever generated by this app.** Fuel cash
that reps collect is rung up on the ταμειακή like any other retail sale; that it is out of
*our* system does not mean it is out of the register.

### Still open, and who owns each

- **Q7, Q8, Q9 and the Q15 deadline — the accountant.** Document types and myDATA codes,
  income classifications, who owns the series and numbering, and the actual legal correction
  window. The "next day" figure in the owner's notes is almost certainly the *transmission*
  deadline, not a correction one; it must not be built to until confirmed.
- **Q2, precisely — the owner.** "The ταμειακή goes through Epsilon" has two readings:
  Epsilon is the issuing system (a certified ταμειακό σύστημα, which would also explain how
  a rep cuts a receipt at a hotel), or Epsilon is merely where a separate ΦΗΜ's data lands.
  The question is *ποιο ακριβώς προϊόν κόβει την απόδειξη, και σε τι συσκευή.* The pickup and
  return screens cannot be designed without it.
- **Q4, the provider.** *(Demotion withdrawn 4 Sep 2026 — see §44. Retail moves onto the
  provider, so Q4 governs ~100% of documents and is back on the critical path.)*
  Now much less urgent, governing under 5% of documents. Epsilon is
  the front-runner by default because it already owns the retail path; moving away means
  either two vendors or replacing a working ταμειακή. Get its API answer in writing anyway:
  whether a custom application can call it, whether it covers λιανική, cost per document,
  and whether there is a sandbox.
- **Q17, credentials.** Two separate sets: myDATA's for the registry, the provider's for
  invoicing. Sandbox first, production after a successful test, and never through this
  questionnaire.

### Two things this already implies for the codebase

- **`bookings.pay_method`'s `transfer` value is dead** (answer 11) and wants a migration.
- **Build issuance behind a provider-agnostic seam** — one interface, one adapter per
  provider. It costs almost nothing now, it survives a change of provider, and it is the
  only decision here that keeps every option open.

Akos becoming a Πάροχος itself was considered and rejected for this project (Α.1112/2025
sets no capital requirement, but ISO-27001, adequate technical staffing for a client
network, and a committee-gated release process put it 12–18 months out, past launch). The
**Ιδιοπάροχος** route — self-issuing purely in-house — is closed outright: it requires
gross revenue of at least €50,000,000 and covers B2B only.

See `src/lib/accountant/questionnaire.ts` for the questions as put, and
`/accountant-questionnaire` for the form the accountant answers them on.

### What one of their actual receipts settled (4 Sep 2026)

The owner sent a photograph of a real receipt, dated 3.9.2026 08:23. It answered more than
the preceding three rounds of questions, and corrected one thing this section had wrong.

**ΦΠΑ IS 17%, NOT 24%.** The line reads `ΕΝΟΙΚΙΑΣΕΙΣ ΑΥΤΟΚΙΝΗΤΩΝ  170,00  17,00%`. The
business is in Καρδάμαινα, Κως, and Κως is one of the islands whose VAT rates are reduced by
30% (17% / 9% / 4% in place of 24% / 13% / 6%), still in force through 2026. Assumption 4
in the questionnaire asserted 24% and was simply wrong; it now states 17% and cites this
receipt.

This is not cosmetic. Prices in this app are VAT-inclusive whole euros (§ the whole-euro
rule), so the net/VAT split is derived, and deriving it at the wrong rate puts a wrong
number on every document. At 17%, €170 gross is €145,30 net plus €24,70 VAT.

One thing left with the accountant: the 30% reduction excludes «μεταφορικά μέσα», and it
needs to be explicit that the exclusion covers the *sale* of a vehicle and not its *hire*.
The till is programmed at 17% and has been for some time, so this is a confirmation to
obtain rather than a doubt to act on.

**The ΦΗΜ is a real fiscal device, and the ΦΗΜ↔POS interconnection is already done.** The
receipt carries `*ΦΟΡΟΛΟΓΙΚΗ ΑΠΟΔΕΙΞΗ-ΕΝΑΡΞΗ*` / `-ΛΗΞΗ*` markers and a ΠΑΗΨΣ signature, so
answer 2 is settled beyond doubt: retail is issued by a fiscal device, not by a provider.
The EFT/POS approval block prints on the same receipt and ends with
`ΑΡ.ΦΟΡ/ΚΗΣ ΑΠΟΔΕΙΞΗΣ 853`, tying the card transaction to the fiscal receipt number. That
is Α.1155/2023 working already, and it is one requirement nobody has to build.

*Both halves of that paragraph are overtaken by §44 (4 Sep 2026). It describes how retail is
issued **today**, not how it will be: the owner has since decided receipts go out by email,
which moves retail onto the provider. And "one requirement nobody has to build" is exactly
backwards under that decision — standing the ΦΗΜ down takes the POS interconnection with it,
and it has to be re-established against the provider. See §44.*

**Every field `ClientCorrelations` needs is printed on it.** The Ψηφιακό Πελατολόγιο links a
registry entry to a ΦΗΜ receipt by four values, and the receipt carries all four:

| DCL field | On the receipt |
|---|---|
| `FIMNumber` (Αρ. Μητρώου ΦΗΜ) | `DMT 24001266` — three letters plus eight digits is the registry format |
| `FIMAA` (αύξων αριθμός) | `ΑΡ.ΑΠΟΔ:00000853`, repeated as `853` |
| `FIMIssueDate` | `ΗΜΕΡΑ:03-09-2026` |
| `FIMIssueTime` | `08:23` |

So the correlation step is buildable. What it costs is still what §43 said: a rep has to get
those values off the register and into the app at handover. The registry number is constant
per device, so realistically only the receipt number needs typing.

**The document is one line, not an itemised rental.** No day count, no breakdown, no
customer details, no ΑΦΜ. Whatever the app eventually sends for retail is a single service
line at the rental total, which matches how the register is already programmed.

**08:23 confirms issuance at handover.** That is inside the 08:30 pickup window (§5), so the
receipt was cut at the desk as the car went out, exactly as answers 10 and 14 described.

**Client item 7 is now partly unblocked.** The receipt gives the registered name
`MAVROS GROUP ΜΟΝΟΠΡΟΣΩΠΗ ΙΚΕ`, the trading name `MAVROS INTERNATIONAL`, `ΑΦΜ 803257894`,
`ΔΟΥ ΚΩ`, and the town, Καρδάμαινα, Κως. `app_settings.company` still needs the full street
address, phone and insurer before `contractReadiness()` will pass, and nothing here is
seeded automatically — src/lib/contract/company.ts is deliberate that an invented field on a
signed agreement is worse than a blocked one.

## 44. Receipts go out by email, and paper is the fallback — which moves retail onto the Πάροχος

Decided by the owner 4 Sep 2026: **the receipt is delivered digitally, by email, and printing
is the backup.** Printing happens from the app to an ordinary A4 printer, on the desktop in
the main office, and only from the manager (`admin`) account.

That reads as a delivery decision. It is not. It decides who issues the document, and it
reverses the largest finding in §43.

### Why an email receipt is an issuance decision

§43 settled that this app is never the issuer past 31.12.2026, and that retail is cut on the
ταμειακή at the desk. A receipt the app emails and prints cannot come off a till roll. There
is one shape that reaches email-only delivery without the app becoming an issuer:

**Retail (λιανική) moves off the ΦΗΜ and onto the Πάροχος**, alongside the B2B slice. The app
requests, the provider issues, seals and returns the document with its ΜΑΡΚ and QR, and the
app delivers what came back. The app still never issues. It becomes the delivery channel for
a document it did not make.

So §43's headline finding — "over 95% of documents never touch a provider at all" — does not
survive. Under this decision roughly **100% of documents pass through the provider**, and the
sentence in §43's receipt subsection that answer 2 is "settled beyond doubt: retail is issued
by a fiscal device, not by a provider" describes the present, not the design. Q2 in the
questionnaire already asks the right question in the right words — *«Από ΦΗΜ, ή και αυτές
μέσω του Παρόχου;»* — so no new question is needed. The owner has now answered his half of
it; the accountant's half, whether this business may drop retail issuance from its ΦΗΜ and
run it through a provider instead, stands exactly as written and is now the pivotal legal
item on the project.

### What it buys

**§43's new burden at the desk disappears.** That section flagged that `ClientCorrelations`
links a Ψηφιακό Πελατολόγιο entry to its document by ΦΗΜ details, and therefore that a rep
would have to read the receipt number off the register and type it into the app at handover,
with a guest waiting. If the provider issues, the app receives the ΜΑΡΚ in the response and
correlates by ΜΑΡΚ. No new field, no typing, and that whole error class is gone.

**One issuance path instead of two**, which is what Q2's own «Γιατί ρωτώ» predicted would be
"far simpler for me".

**Q2's remaining owner-side ambiguity stops mattering for the future.** Which Epsilon product
cuts the receipt and on what device is a question about the current setup, not the built one.

### What it costs, and one cost is sharper than it looks

**Provider fees land on all volume, not under 5%.** §43 demoted Q4 to "much less urgent,
governing under 5% of documents". That demotion is withdrawn: per-document price is now a
real running cost on every rental, and Q4's sub-question — whether the provider covers
αποδείξεις λιανικής or only τιμολόγια — is a go/no-go, not a detail.

*Qualified the same day: this holds only if the provider charges per document. Wrapp does
not — see the subsection below. Whether it bites depends entirely on which provider wins, so
it stays a question to ask rather than a cost to assume.*

**Connectivity becomes fiscally critical.** A ΦΗΜ issues offline. A provider API call does
not. See the offline path below.

**Retiring the ΦΗΜ is a formal ΑΑΔΕ procedure**, and like the accountant's Epsilon
transmission (§43 answer 1) it has to stop on exactly the day the app goes live — not before,
not after. Accountant's work, not code.

**And it breaks a working POS interconnection.** This is the sharpest consequence and it was
not visible before the receipt photograph. §43 records that the ΦΗΜ↔POS interconnection under
Α.1155/2023 is already live: the EFT/POS approval block prints on the same receipt and ends
`ΑΡ.ΦΟΡ/ΚΗΣ ΑΠΟΔΕΙΞΗΣ 853`, tying the card transaction to the fiscal receipt number. §43
called it "one requirement nobody has to build". Retiring the ΦΗΜ retires that link with it,
and the interconnection has to be re-established against the provider instead. Payment is
cash and card only (answer 11), so card is a real share of takings and this cannot be left
to discover at cutover. It is a question for Epsilon *and* for the POS acquirer, in writing,
before the ΦΗΜ is decommissioned.

### The delivery design, as decided

1. **Email is the default.** The guest's address is captured at handover and the provider's
   returned PDF is sent to it.
2. **At a hotel, a QR on the rep's phone.** A guest with no usable email, or who declines to
   give one, scans a QR the rep shows and gets the document on their own phone. The app
   stores the returned PDF and serves it on an unguessable signed link; the QR points there.
   This works at every hotel, needs no hardware, and is the reason no mobile printer is being
   bought.
3. **Paper on request, posted from the main office.** A guest who wants a printed copy gets
   it sent from the office rather than handed over at the hotel. That is the owner's ruling
   and it is what makes the manager-desktop-only print scope coherent.
4. **A4 print is an `admin` action, enforced server-side.** Roles are already `admin | rep`
   (`db/schema.sql`), so no new role is needed; `admin` is the manager account. Hiding the
   button is not the control — the route re-checks the caller.
5. **The printed page is the provider's PDF, verbatim.** `src/lib/contract/render.ts` is not
   the model here. That renderer builds a document of ours; a fiscal receipt is sealed by the
   provider and re-rendering it locally would put an unsealed lookalike on paper. We print
   what came back, unaltered.
6. **A failed send is visible, not silent.** `src/lib/email/mailer.ts` returns
   `not_configured` / `failed` and the contract flow records that honestly rather than
   claiming a send. A receipt needs the same honesty plus a manager-visible backlog of
   undelivered documents that can be re-sent or printed. A contract copy that does not arrive
   is an inconvenience; a receipt that does not arrive is a document the customer never got.

### The offline path: hand over, queue, issue on reconnect

Decided by the owner 4 Sep 2026. If the provider is unreachable or the rep has no signal, the
**car goes out anyway**. The document is queued and issues when the connection returns. The
alternative — no document, no keys — was rejected: one bad signal at a hotel would strand a
guest and a rep beside a car they cannot release.

This needs three things built and one ruling obtained:

- A pending-issuance queue that survives a process restart, with retry.
- A manager-visible backlog, so a document stuck for hours is seen rather than discovered at
  the VAT return.
- Correlation deferred with it: the Ψηφιακό Πελατολόγιο entry is real-time on both ends
  (§43), so the registry entry goes in at handover and the ΜΑΡΚ attaches later.
- **The ruling: can the issue date still be the handover date?** §43 answer 10 fixes the
  issue date at the handover and the VAT period with it. A document issued on reconnect may
  carry a later timestamp, and if that crosses a month boundary it moves the sale into the
  wrong VAT period. This is the accountant's, and it belongs with the Q15 correction-window
  question that is already open.

### What is now blocked on what

- **The accountant:** may retail be issued through a Πάροχος and the ΦΗΜ stood down (Q2), and
  the deferred-issuance date ruling above.
- **Epsilon, in writing:** does the API cover λιανική, at what cost per document, and does it
  carry the Α.1155/2023 POS interconnection.
- **Client item 8, the domain.** Email-first receipts hard-depend on it. `mailer.ts` is
  complete and returns `not_configured` because there is no domain to send from; until that
  lands, the default delivery channel does not exist.
- **Retention:** a fiscal document's retention period is its own, and longer than the
  customer ledger's. It has to be set before the first stored PDF, not after.

Nothing here changes the storage or issuance code, because none of it exists yet. What it
changes is the shape of what gets built: one path, not two, and the provider seam §43 already
called for is now on the critical path rather than serving a 5% slice.

### Wrapp as the fallback provider, if Epsilon does not work out (4 Sep 2026)

The owner named **Wrapp** (wrapp.ai) as the provider to fall back on. It was evaluated
against the items this section leaves open, and it answers all of them, plus one this section
did not think to ask.

**The licence is real and was confirmed away from the vendor's own site.** WRAPP AE appears
on ΑΑΔΕ's published list of αδειοδοτημένα λογισμικά παρόχων ηλεκτρονικής τιμολόγησης
(`aade.gr/en/mydata/adeiodotimena-logismika-parohon-ilektronikis-timologisis`), among 39
entries. Wrapp advertises «κωδικό παρόχου 029»; the ΑΑΔΕ page numbers its list sequentially
rather than by provider code, so the code itself is unconfirmed and is a detail for the
accountant, not a doubt about the licence.

**The per-document cost worry above does not apply to this provider, and comes out.** Wrapp
sells a flat annual subscription with unlimited issuance, not a fee per document: Standard
€109, Business €139, Pro €169 (all per 12 months), Pro All-in-One €279 per 12 months or €359
per 24 months. **API key access is in Pro All-in-One only**, so €279/year is the figure that
matters here. Against the volume of a rental fleet that is not a running cost worth designing
around. Read off a public plans page and to be confirmed in writing, but the *shape* — flat,
not per-document — is the vendor's stated model.

**Retail is their headline proposition, not a footnote.** The Standard plan is described as
covering receipts *with no cash register*, and the API carries 11.1 (ΑΛΠ) and 11.2 (ΑΠΥ)
explicitly. The general Greek position — that a πάροχος may issue αποδείξεις λιανικής and
replace the ταμειακή outright — is well attested independently of Wrapp. It remains the
accountant's ruling under q2, but the route is a productised one rather than a theory.

**The POS interconnection, the sharpest cost above, is covered — conditionally.** Wrapp
exposes `/pos_devices` and acts as a POS aggregator across Viva, Worldline, Cardlink, Nexi,
MyPos, NBG Pay and Epay, claiming Α.1155/2023 compliance with the card amount routed from
the issuing system to the terminal. That is conditional on the terminal at the desk being one
of those. **New question for the owner: which acquirer and which terminal model is the POS?**
The receipt photograph in §43 shows the EFT/POS approval block but does not name the bank.

**It also covers the Ψηφιακό Πελατολόγιο, which §43 assumed would stay ours.** The API has
`/digital_clienteles/create`, `/show`, `/update`, `/cancel`, and both `correlate_by_mark` and
`correlate_by_fim`. Assumption 3 in the questionnaire states the registry stays a direct
integration of ours; that is now a choice rather than a given. Keeping it direct stays
vendor-independent and keeps the §43.3 penalty exposure (€100 per unrecorded vehicle) under
our own control; routing it through Wrapp is less work and `correlate_by_mark` is exactly
the call §44's design needs. Not decided here — recorded so the assumption is not treated as
settled when it no longer has to be.

**What fits the design already decided above:**

- **`external_id` gives idempotency**, which is what makes the offline queue safe. A retry
  after reconnect cannot issue the same rental twice.
- **`POST /invoices` returns `my_data_mark`, `my_data_uid`, `my_data_qr_url` and
  `wrapp_invoice_url` synchronously.** So the QR-on-the-rep's-phone fallback works at the
  moment of handover, with no wait.
- **The PDF is asynchronous**, delivered by an `invoice-pdf` webhook with a default 120s
  delay. The emailed copy therefore follows the handover rather than coinciding with it, and
  **the handover must never block on a PDF.** A `thermal-print-pdf` event also exists and is
  unused here: the decision above is A4.
- **Draft then issue** (`POST /invoices/:id/issue_draft`) preserves the B2B draft path §43
  kept.
- **VAT 17 is in the accepted set**, matching Κως (§43's receipt).
- **Webhooks are signed** — `X-Webhook-Secret`, HMAC-SHA256. Verify it. An unverified webhook
  is not truth.
- **Auth is an `api_key` exchanged at `POST /api/v1/login` for a JWT valid 24 hours.** The
  api_key is a server-side secret and never reaches the browser.
- **A sandbox exists**, on free registration, which satisfies the sandbox-first rule in §43's
  Q17.
- **ISO 27001:2022**, which matters because they become a data processor.

**Two commercial routes, and the link the owner sent is the second one.** The direct route is
that the business buys Pro All-in-One and we integrate against its API key — right for one
client. The partner programme at `/api/becomeapartner` is multi-tenant: programmatic
provisioning through a Partners API, Wrapp billing each end client directly, volume discounts
past 500 tenants. That is a route for reselling this across other clients later, not for this
build.

**Still to obtain before Wrapp is more than a candidate:** the prices and the API-tier
boundary in writing, confirmation that "API Key Access" means the full issuance REST API, and
the acquirer/terminal answer. None of it displaces q2, which the accountant must rule on
whichever provider wins.

**Against Epsilon.** Epsilon's advantage is that it already owns the retail path, so nothing
migrates. Wrapp's are a flat price instead of a per-document one, and a public, documented
API — §43 had to record that Epsilon's API answer was still to be obtained in writing. Not a
decision until Epsilon answers.
