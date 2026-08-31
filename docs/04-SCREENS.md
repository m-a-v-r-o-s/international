# International Rentals — Screen Inventory

Mobile-first throughout. The rep app is designed for **one hand, at a hotel desk, in
sunlight, with a guest waiting**. Speed and legibility beat elegance. The admin app is the
same codebase, wider layouts on desktop.

Motion is deliberately **restrained** here — this is an operational tool used 20 times a day,
not a showcase site. Transitions exist to explain state changes, nothing more.

---

## REP APP

### R1 · Today
Landing screen. Their own pickups and returns for today, in time order.
Each row: time · plate · model · guest name · hotel room · status chip.
Big primary action per row: **Start pickup** / **Start return**.
Footer strip: **cash in hand today** + `Hand over` action. *(The only aggregate a rep sees.)*

### R2 · Availability
The core lookup. Pick a date range → the fleet, grouped by category.
Each car: photo thumb, plate, model, spec chips, and a free/occupied bar across the range.
Occupied is a **flat neutral block with no label** — no rep, no reason, no times, ever.
Filters: category, transmission, seats, A/C.
`Book this car` on any car free for the whole range.

### R3 · New booking
1. **Dates** — start, end, pickup time (default 08:30–11:30), drop-off time
   (default 18:00–21:00). Day count shown live: *"Mon → Wed = 3 days"*.
2. **Car** — from R2, or re-picked here.
3. **Hotel + room** — defaults to the rep's own hotel; changeable when covering elsewhere.
4. **Guest** — first, last, phone, date of birth.
5. **Extras** — baby seat type (infant ≤1 / child 1–4 / booster), additional drivers. Free.
6. **Price** — returned by the server, read-only, with the day breakdown shown.
Confirm → `Booked`.

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
1. **Fuel in** — eighths slider. A shortfall is **recorded and flagged**, never priced.
2. **Damage** — pre-existing marks shown greyed; new marks added in a distinct colour.
   Any new mark raises an exception for the boss.
3. **Confirm** → `Returned`. Remaining dates reopen in availability immediately.

### R6 · My bookings
Their own history — searchable by guest name, plate or date. Price shown per booking.
**No totals.** Tap through to the full record and the signed contract PDF.

### R7 · Booking detail
Everything about one booking. Before pickup: `Edit`, `Cancel`.
After pickup: read-only except **`Extend`** — new end date, availability re-checked, and if
the car is taken later, same-category alternatives are offered for a swap.

### R8 · Settings
Language (Ελληνικά / English), PIN and biometric setup, notification preferences, log out.

---

## ADMIN APP

### A1 · Movements sheet
The paper day-sheet, replaced. Any chosen day, all hotels: pickups then returns, in time
order, with car, guest, hotel, room and rep. Printable. This is the boss's morning screen.

### A2 · Fleet board
All ~100 cars, live: out / free / blocked / back today. Filter by category or status.
Tap a car → its calendar, its history, its record.

### A3 · Car management
Add, edit, archive, delete. Photo, plate, make, model, category, year, colour, transmission,
fuel, seats, doors, A/C, tank litres. **Block a date range** with an admin-only reason.

### A4 · Pricing
Pricing periods for a season (add, edit, drag the boundaries) with overlap prevented.
Per period: an 8 × 7 grid of totals, plus the 8+ day per-extra-day rate per category.
Bulk paste from a spreadsheet. A preview showing what a sample rental would cost.

### A5 · Bookings
Every booking, every rep, every hotel. Search by guest, plate, date, rep, hotel, status.
Full edit rights at any stage — including price. Every change audit-logged.

### A6 · Exceptions queue
The boss's inbox: fuel shortfalls, new damage with photos, late returns, no-shows,
eligibility override requests. He sets the charge and closes the item.
This is where every non-standard event in the business lands.

### A7 · Reports
Revenue by day / month / rep / category. Booking counts. Simple fleet utilisation.
CSV export for any date range. Kept deliberately plain.

### A8 · Users & hotels
Create reps, assign hotels (primary and cover), deactivate — never delete, so history stays
intact. Manage hotels.

### A9 · Audit log
Filterable by actor, entity and date. Read-only. Permanent.

### A10 · Settings
Company legal details for the contract, contract terms text (Greek + English), licence
retention window, pickup and drop-off default windows.

Plus the **Ψηφιακό πελατολόγιο** section (docs/01-DECISIONS.md §25a), directly under
licence retention so the two stores of guest data are read side by side and their
difference is obvious: how many customers are held, how many have licence photographs, a
search-then-erase desk for a guest who asks to be forgotten, and the clear-the-whole-ledger
button behind three separate confirmations. There is deliberately **no retention-window
field** in that section — there is no window, and a disabled box implying there might be
would be worse than its absence. The section states that in as many words.

---

## Public pages
Privacy policy · Terms · Cookie consent banner · Custom branded 404 · Login.
Footer on every public page: **© {year} Akos Digital Services** — the name linking to
`https://akosds.com`.
