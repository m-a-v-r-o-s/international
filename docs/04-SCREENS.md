# International Rentals — Screen Inventory

Mobile-first throughout. The rep app is designed for **one hand, at a hotel desk, in
sunlight, with a guest waiting**. Speed and legibility beat elegance. The admin app is the
same codebase, wider layouts on desktop.

Motion is deliberately **restrained** here — this is an operational tool used 20 times a day,
not a showcase site. Transitions exist to explain state changes, nothing more.

Every form that edits something already saved carries **Save and Cancel together**
(`src/components/FormActions.tsx`). Save is dead until a field actually differs from what
the server rendered, so a tap that would write nothing cannot be made; Cancel puts every
field back to that same starting point. Forms that create a row keep Save live — their
opening values are the thing being saved — but still offer the way out. The disabled
attribute is a hint to the person, never the control: every action re-checks its own
preconditions server-side.

---

## REP APP

### R1 · Today
Landing screen. Their own pickups and returns for today, in time order.
Each row: time · plate · model · guest name · hotel room · status chip.
Big primary action per row: **Start pickup** / **Start return**.
Footer strip: **cash in hand today** + `Hand over` action. *(The only aggregate a rep sees.)*

### R2 · Availability
The core lookup. Pick a date range → the fleet as a **visual list of car models**, grouped
under their group heading (docs/01-DECISIONS.md §39).
One card per model: the model's photo, its name, gearbox and seats, a pip bar with one pip per
plate, and **`n of m free`** for the whole range. Cards run left to right, two to a line on a
phone, wrapping onto the next line.
A model with **nothing free is greyed out and keeps its place**, labelled *None free* in words
as well as in colour.
Occupied is a **flat neutral fact with no label** — no rep, no reason, no times, ever; a count
of free plates is that same fact added up.
**No filters and no submit button** — the two dates are the whole search, and changing one
re-loads the list. `Plates` on a card lists the individual plates for the rep who wants to
choose; `Book` takes the first free one.

### R3 · New booking
1. **Dates** — start, end, pickup time (default 08:30–11:30), drop-off time
   (default 18:00–21:00). Day count shown live: *"Mon → Wed = 3 days"*.
2. **Car** — from R2, or re-picked here.
3. **Hotel + room** — defaults to the rep's own hotel; changeable when covering elsewhere.
4. **Guest** — first, last, phone, date of birth.
5. **Extras** — baby seat type (infant ≤1 / child 1–4 / booster), additional drivers. Free.
6. **Price** — returned by the server, read-only, with the day breakdown shown.
Confirm → `Booked`.

### R3b · Booking confirmation
Reached from the **header, on every screen**, by reps and by the admin alike
(docs/01-DECISIONS.md §30) — a phone call does not wait for the right page to be open.
For a guest who orders a car by telephone. Collects the **phone number, hotel + room, car,
dates and child seats**, and offers a **name it never requires**. No date of birth: it is
read off the licence at pickup, where the eligibility gate needs it anyway.
The price is shown, read-only, from the same server quote R3 uses — the caller always asks.
A returning number fills the name in from the ledger (§25a), exactly as R3 does.
Confirm → `Booked`, and the rep lands on the booking slip.

### R4b · Write up the contract
The other header button, also both roles. The contract flow itself is R4's agreement step and
is unchanged; what this adds is a way IN that is not "find the booking, open it, start
pickup". Two doors:
1. **An existing booking** — every `booked` rental the caller can see with no signed
   agreement against it, searchable by name, phone, plate or reference. Tapping one opens
   that booking's pickup flow.
2. **No booking — walk-in** — a guest at the desk with nothing booked, taking a car now.
   R3b's form with today's dates and the current time, then straight on into the pickup flow.
   A contract cannot exist without a rental beneath it (`contracts.booking_id` is NOT NULL),
   so one is made here.

Both doors open at R4 step 1, the licence — **never at the signature**. The eligibility gate
(§11) stays in front of the agreement, which is where R4 already put it.
A rental already `out` with no contract is not listed: R4 stops at "already out", so the link
would go nowhere.

### R4 · Pickup flow
Sequential, one thing per screen, resumable if the app is closed.
1. **Licence capture** — camera, front then back, per driver. OCR runs, fields come back
   pre-filled and fully editable. Manual entry always available.
2. **Eligibility gate** — age vs the category minimum, licence held ≥1 year, expiry beyond
   the return date. **Fails hard.** The screen states exactly which rule failed and offers
   `Request admin override`. No proceed button for the rep.
3. **Fuel out** — eighths slider.
4. **Damage** — tap the car diagram to mark existing damage; optional photo per mark.
5. **Agreement** — bilingual PDF preview, guest signs on screen.
6. **Copy** — optional email, or skip.
7. **Payment** — amount, method, paid/unpaid.
→ `Out`.

### R5 · Return flow
1. **Fuel in** — eighths slider. A shortfall is priced by the database on confirm, at the
   admin-set rate per missing eighth; the screen states the amount before the rep confirms.
2. **Confirm** → `Returned`. Where there is a shortfall, the amount taken from the guest and
   how they paid it are recorded here, in the same tap — pre-filled with what is owed and
   editable, because what the rep writes is what actually crossed the desk. Cash lands in
   their own cash in hand (§7). Remaining dates reopen in availability immediately.

There is no damage step. Anything wrong with the returning car is reported as an incident
(R9), in words and photographs, which is how damage is actually described.

### R9 · Incidents
What this rep has sent to the boss, and the form that sends it: pick the contract, write what
happened, add photographs one at a time, send. Open or dealt-with is all a rep sees of the
outcome — never the charge, never what the boss wrote (§14).
Reachable from the sidebar and from a booking's own screen, which pre-selects the contract.

### R6 · My bookings
Their own history — searchable by guest name, plate or date. Price shown per booking.
**No totals.** Tap through to the full record and the signed contract PDF.

### R7 · Booking detail
Everything about one booking. Before pickup: `Edit`, `Cancel`.
After pickup: read-only except **`Extend`** — new end date, availability re-checked, and if
the car is taken later, same-category alternatives are offered for a swap.

### R8 · Settings
Language (Ελληνικά / English), PIN change (§38 — the same `/change-pin` screen a rep is sent
to while still holding one the boss issued), log out. **Not built:** biometric unlock.
Notifications (0027) were removed outright (0036) rather than left as a preference.

---

## ADMIN APP

The admin's sidebar is these screens, then the rep screens appended under a **Front desk**
heading — Availability, New booking, My bookings — because "even the boss makes bookings
sometimes" (docs/01-DECISIONS.md §30). Additive: nothing of his is removed and there is no
mode to be in the wrong one of. Both header buttons (R3b, R4b) are his as well.

### A1 · Movements sheet
The paper day-sheet, replaced. Any chosen day, all hotels: pickups then returns, in time
order, with car, guest, hotel, room and rep. Printable. This is the boss's morning screen.

### A2 · Fleet  *(A3 · Car management folded in)*
One screen, one list: all ~100 cars grouped by model, each plate carrying today's status —
out / free / blocked / back today. The counts for the whole yard and the category/status
filters sit above it. Tap a car → its calendar, its history, its record.

Managing the fleet happens on the same screen, because A2 and A3 were two lists of the same
hundred plates. **Two doors above the list** (docs/01-DECISIONS.md §40): `Add a car model` —
make, model, group, gearbox, fuel, seats, doors, engine cc, horsepower, tank litres and a
**required photo** — and `Add a plate`, which must name a model that already exists. Each model
heading carries its photo and an `Edit model` disclosure; edit, archive or delete a plate on
its own record, which also **blocks a date range** with an admin-only reason. Archived cars
carry no status and are not counted or filtered — they keep their own collapsed list at the
foot. A3's number is kept so every reference to A4-A10 still points where it did.
The **groups** themselves (their names, minimum age and licence years) live in A10 Settings,
because a group is a pricing and eligibility band rather than a car.

### A4 · Pricing
Pricing periods for a season (add, edit, drag the boundaries) with overlap prevented.
Per period: an 8 × 7 grid of totals, plus the 8+ day per-extra-day rate per category.
Bulk paste from a spreadsheet. A preview showing what a sample rental would cost.

### A5 · Bookings
Every booking, every rep, every hotel. Search by guest, plate, date, rep, hotel, status.
Full edit rights at any stage — including price. Every change audit-logged.

### A6 · Incidents queue
The boss's inbox: what the reps have sent in, each one a rep's own words and photographs
against one contract. He sets the charge, writes what he decided, and closes the item.
Neither figure ever reaches a rep's device — both are outside their column grant.
Filter is open / closed / all; there is no type, because an incident does not have one.

### A7 · Reports
Revenue by day / month / rep / category. Booking counts. Simple fleet utilisation.
CSV export for any date range. Kept deliberately plain.

### A8 · Users & hotels
Create reps, assign hotels (primary and cover), issue and re-issue a rep's PIN (§32 — it is
their whole credential, shown once and never recoverable), and remove an account. "Remove"
is deactivation under a name the boss recognises — never a delete, so history stays intact —
behind a confirm dialog that says so, and it is reversible from the same page. Manage hotels.

### A9 · Audit log
Filterable by actor, entity and date. Read-only. Permanent.

### A10 · Settings
Company legal details for the contract, contract terms text (Greek + English), licence
retention window, pickup and drop-off default windows.

The **Ψηφιακό πελατολόγιο** left this screen for A11 (docs/01-DECISIONS.md §30). What stays
is a pointer to it, carrying the "these records never expire" line — because the reason the
section was here was to be read beside licence retention, and the boss should not be able to
read about the store that empties itself without being told about the one that does not.

### A11 · Ψηφιακό πελατολόγιο
The customer ledger (docs/01-DECISIONS.md §25a), its own sidebar item since §30. How many
customers are held, how many have licence photographs, a search-then-erase desk for a guest
who asks to be forgotten, and the clear-the-whole-ledger button behind three separate
confirmations. There is deliberately **no retention-window field** — there is no window, and
a disabled box implying there might be would be worse than its absence. The screen states
that in as many words, and links back to A10 for the licence window it is not.
**Admin only**, and not merely by hiding a link: reps hold no `SELECT` on `public.customers`,
and erasure and clearing are admin RPCs that refuse them.

### A12 · Cash
The boss's queue of cash hand-over receipts nobody has confirmed yet, oldest first: rep,
amount, when. `Confirm received` is the **only** action that clears a rep's own cash-in-hand
figure on R1 (docs/01-DECISIONS.md §31) — a rep's own "hand over" tap records the claim but no
longer zeroes anything by itself. Almost always at most one row per rep, the usual single
hand-over at the end of the morning shift; a second row for the same rep the same day is the
rare, legitimate case — a night-shift pickup or a delayed payment, handed over again before
the first is confirmed.

---

## Public pages
Privacy policy · Terms · Cookie consent banner · Custom branded 404 · Login.
Footer on every public page: **© {year} Akos Digital Services** — the name linking to
`https://akosds.com`.
