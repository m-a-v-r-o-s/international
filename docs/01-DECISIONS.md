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
- Do reps need to **search past customers** for a returning guest, or is every booking a
  fresh record? *(Assumed: reps search only within bookings they can see; admin searches all.)*
- Is there a **minimum rental length**? *(Assumed: 1 day.)*
- Is there a **maximum forward booking window**? *(Assumed: none.)*
- Which fuel charge rate applies — a per-litre figure or the boss's judgement each time?
  *(Assumed: the boss's judgement, since all fuel shortfalls route to him as exceptions.
  The app records the shortfall in eighths and litres, and charges nothing automatically.)*
