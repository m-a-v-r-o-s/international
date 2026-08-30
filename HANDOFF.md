# HANDOFF — International Rentals ops app

**Read this first, then `docs/01-DECISIONS.md` in full. Do not start writing code before
you have read both.**

You are building an internal operations app that replaces pen and paper for a Greek
rent-a-car company with ~100 cars, one boss and 6–10 hotel-based reps.

## Document map

| File | What it is | When you need it |
|---|---|---|
| `docs/01-DECISIONS.md` | Every business rule, settled with the client | Always. Start here |
| `docs/02-ARCHITECTURE.md` | Stack, the availability and pricing engines | Before any data or logic work |
| `docs/03-SECURITY.md` | Permission matrix, RLS model, threat model | Before any endpoint or query |
| `docs/04-SCREENS.md` | Screen-by-screen inventory | Before any UI work |
| `docs/05-BUILD-PLAN.md` | Phases, order, required tests, risks | To know what to pick up |
| `db/schema.sql` | Reference schema draft | Phase 1 |

## The five things that will sink this project if you get them wrong

1. **A day is inclusive, morning to night.** Mon pickup → Wed return = **3 days**, and the
   car is held through the whole of Wednesday. Every date calculation in this codebase
   follows that rule. `end_date - start_date` is never the answer; `+ 1` is.
2. **The exclusion constraint in `bookings` is the double-booking guarantee.** If an insert
   fails against it, the car is genuinely taken — surface that to the rep. Never weaken or
   drop the constraint to make a test pass.
3. **A rep must never see an aggregate.** Not a count, not a sum, not an average. The one
   exception is their own cash collected today. Before you add any number to a rep screen,
   ask whether company revenue could be inferred from it.
4. **Price is server-side only.** Never ship a price table to a rep's client. They receive
   one number for the booking in front of them.
5. **Eligibility is a hard block.** A rep cannot proceed past a failed age or licence check.
   Only the admin overrides, and the override is recorded.

## Working rules

**Stack is decided** — Next.js App Router + TypeScript, Supabase, Railway, deployed to the
Play Store as a TWA. Do not substitute. If you believe a decision is wrong, say so in your
report; do not quietly build something else.

**Authorisation lives in the database.** Every table has RLS on with real policies. A route
handler check is a second layer, never the only one. If you find yourself relying on the
client to send the right filter, stop.

**Money is integer cents.** No floats in pricing, payment or reporting.

**Dates are `date`, not `timestamptz`,** wherever the rule is "a day is morning to night".
Pickup and drop-off *times* are separate fields and never affect availability.

**Greek and English from the first commit.** No hard-coded user-facing strings, ever. The
client's market is bilingual and retrofitting i18n is a rewrite.

**Mobile-first, WCAG 2.1 AA.** Reps use this one-handed, on a phone, in sunlight, with a
guest waiting. Contrast, focus order, ARIA labels and keyboard paths are requirements, not
polish. The camera and signature flows need accessible alternatives.

**Motion is restrained here.** This is an operational tool used twenty times a day, not a
showcase site. Transitions explain state changes; nothing decorative.

**Every write is audit-logged** — actor, entity, before, after, timestamp.

## Git

- **Commit only. Never `git push`.** No exceptions, including right before a deploy.
- Commits are authored as **m-a-v-r-o-s**. **No `Co-Authored-By: Claude` trailer**, no
  Claude or Anthropic attribution of any kind.
- Small, focused commits with real messages.

## Definition of done for any task

- [ ] Behaviour matches `docs/01-DECISIONS.md` exactly — no invented rules, no quiet scope changes
- [ ] RLS policy written and **tested from a rep session**, not just from the service role
- [ ] Validated server-side with Zod: type, shape, length, range
- [ ] Writable fields whitelisted — no mass assignment
- [ ] Both languages present, no hard-coded strings
- [ ] Keyboard reachable, labelled, AA contrast
- [ ] Loading state on anything async; error states that say what is actually wrong
- [ ] Tests from `docs/05-BUILD-PLAN.md` covering this area pass
- [ ] `npm audit` clean
- [ ] Committed, not pushed

## Do not

- Do not add commission anywhere. This business has none.
- Do not add deposits, odometer readings or service scheduling. Explicitly out of scope.
- Do not build a customer-facing booking page, invoicing, myDATA or SMS/WhatsApp.
- Do not add offline booking creation. Online is required by decision.
- Do not let a rep discount, override or negotiate a price.
- Do not expose `block_reason` to a rep under any circumstance.
- Do not add a "helpful" total to a rep screen.
- Do not let OCR failure block a pickup. Manual entry always works.

## Blocked on the client

Phase 1's back half and Phase 4 cannot complete until these arrive. Flag them, work around
them with seed data, and do not invent them:

1. The 8 category names and which of the 20 models belong to each
2. Model specs including tank size in litres
3. The 100-car fleet list (CSV)
4. Price tables — at least one pricing period
5. A scan of the current paper rental agreement and its terms, both languages
6. Hotel list and rep assignments
7. Company legal details for the contract: registered name, ΑΦΜ, address, phone, insurer
8. Domain, and a Google Play developer account

## Where to start

Phase 0 in `docs/05-BUILD-PLAN.md`. Do not skip ahead to screens — the schema, the two
engines and the RLS policies are the load-bearing work, and everything visible depends on
them being right first.
