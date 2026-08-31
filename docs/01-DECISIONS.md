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
  not yet handed over, with a "handed over" action.
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
  Device-bound session.

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
