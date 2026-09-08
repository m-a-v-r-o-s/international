# laptop2pc — handoff from the laptop to the main PC

Written 8 Sep 2026, at commit `bfd782a` ("Give cars a base, and the night before to reach it").
Working tree is **clean** and `master` is **level with `origin/master`** — a `git pull` on the
PC gets everything. Nothing is stranded on the laptop *inside the repo*.

What is **not** in the repo, and therefore not in the pull, is the whole first section below.
Check that list on the PC before starting work, because several items are machine-local and
silently absent rather than obviously broken.

---

## Part 1 — The environment to reproduce on the PC

### 1.1 Machine-local Claude state that git does NOT carry

| Thing | Where it lives on this laptop | Note |
|---|---|---|
| Global profile | `~/.claude/CLAUDE.md` (14.7 KB) | Already known to be a reconstruction — its header says the original lives on the PC. **On the PC: diff, don't overwrite.** The PC copy may be the better one. |
| Project memories | `~/.claude/projects/-home-akos-international-rentals/memory/` | 6 memory files + `MEMORY.md`. **Not synced, not in git.** Listed in 1.2 — copy them or the PC session starts blind. |
| `~/.claude/settings.json` | permissions allow-list, `model: opus`, `effortLevel: high`, enabled plugin, marketplace | See 1.4 |
| `~/.claude/.credentials.json` | OAuth creds | Do not copy; log in on the PC. |
| Project settings | `.claude/settings.local.json` — **this one IS in the repo** | `enableAllProjectMcpServers: true`, `enabledMcpjsonServers: ["supabase"]`, allows `mcp__railway__set-variables` |
| `.env.local` | repo root, gitignored | **The one file you actually have to move by hand.** See 1.6 |

### 1.2 The six project memories (copy these to the PC)

Path on both machines: `~/.claude/projects/-home-akos-international-rentals/memory/`

1. `user_name.md` — Θεοδωρής Μαύρος, Greek form by default
2. `feedback_whole_euro_money.md` — whole euros only, never cents; one carve-out for the
   net/VAT split inside the document builder
3. `mydata-now-in-scope.md` — ΑΑΔΕ work is live; read §43 **and** §44; Wrapp; ΦΠΑ 17%
4. `contract-consent-clause.md` — ledger consent tick box; the agreement clause still owed
5. `supabase_site_url_testing_domain.md` — Site URL still on the testing subdomain
6. `accountant-questionnaire-artifact.md` — published questionnaire + the share-pin gotcha
7. `MEMORY.md` — the index; must list all six or they are never recalled

### 1.3 MCP servers

Seven configured here. Three are **account-level (claude.ai connectors)** and follow the
login, not the machine — they should already be on the PC once signed in. Four are
**machine-local config** and must exist on the PC.

| Server | Scope | Status here | On the PC |
|---|---|---|---|
| `claude.ai custom hugging face` | claude.ai connector | ✓ connected (as `akosds`) | follows the account |
| `claude.ai higgs` (`mcp.higgsfield.ai`) | claude.ai connector | **! needs auth** | follows the account; unused on this project |
| `plugin:supabase:supabase` | via the supabase plugin | ✓ connected | comes with the plugin (1.4) |
| `supabase` (`mcp.supabase.com/mcp?features=docs,account,database,debugging,development,functions,branching`) | project `.mcp.json` / local | **! needs auth** | re-auth with `/mcp` |
| `cloudflare` (`https://mcp.cloudflare.com/mcp`, http) | **user scope** in `~/.claude.json` | ✓ connected | add on the PC |
| `railway` (`https://mcp.railway.com`, http) | **user scope** in `~/.claude.json` | ✓ connected | add on the PC |
| `resend` (stdio, `npx -y resend-mcp`) | **user scope** in `~/.claude.json` | ✓ connected | add on the PC |

⚠️ **The `resend` entry carries a live `RESEND_API_KEY` in plaintext inside
`~/.claude.json`.** It is deliberately not reproduced in this file, because this file is
going into a git repo. Copy it from the laptop's `~/.claude.json` through your password
manager, or just mint a fresh key in the Resend dashboard on the PC and let this one be
rotated out. Do not paste it into any tracked file.

Two of the seven are unauthenticated right now (`higgs`, `supabase`). Neither blocks work:
the Supabase MCP capability is also served by the plugin server, which is connected.

### 1.4 Plugins & marketplaces

- Marketplace: `claude-plugins-official` → github `anthropics/claude-plugins-official`
- Installed: **`supabase@claude-plugins-official` v0.1.15**, user scope
  (`gitCommitSha 8629243`), installed 30 Aug 2026. This is the only installed plugin.
- It is what provides the two `supabase:*` skills and the `plugin:supabase:supabase` MCP
  server.

### 1.5 Skills available in this session

No project-local or user-authored skills exist — `~/.claude/skills/`, `~/.claude/agents/`
and `~/.claude/commands/` are all absent, and the repo has no `.claude/skills/`. Everything
listed below is either built in or comes from the supabase plugin, so it reproduces on the
PC automatically once the plugin is installed:

- From the plugin: `supabase:supabase`, `supabase:supabase-postgres-best-practices`
- Built in: `design`, `dataviz`, `artifact-design`, `artifact-diagramming`,
  `artifact-capabilities`, `update-config`, `keybindings-help`, `code-review`, `simplify`,
  `fewer-permission-prompts`, `loop`, `schedule`, `claude-api`, `run`, `init`,
  `security-review`

Nothing to migrate here. If a skill is missing on the PC, it is a plugin or version
difference, not a lost file.

### 1.6 Versions & the one file to carry by hand

- Claude Code `2.1.251`, native install, `autoUpdates: false`
- Node `v24.19.0`, npm `11.17.0` (`package.json` requires `>=20.9`; CI pins Node 22)
- `.env.local` — **gitignored, and the only thing that will actually stop the app booting on
  the PC.** `.env.example` documents every variable with a comment; the values to move are:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`, `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN`,
  `ANTHROPIC_API_KEY`, the five `SMTP_*` (currently unset — no domain), and the Wrapp block
  (`WRAPP_API_BASE_URL`, `WRAPP_API_KEY`, `WRAPP_ACCOUNT_EMAIL`, `WRAPP_BOOK_APY`,
  `WRAPP_BOOK_TPY`, `WRAPP_BOOK_CREDIT_RETAIL`).
  Move it over a secure channel, not through the repo.
- `npm ci` on the PC. `postinstall` runs `scripts/fix-embedded-pg-libs.mjs`, which patches
  `embedded-postgres` — the test suite needs it and it is platform-sensitive, so if `npm test`
  fails at startup on the PC, look there first rather than at the SQL.
- `npm test` needs **no Docker and no network** — it starts its own Postgres 18 in-process.

### 1.7 Infrastructure (same accounts, nothing to move)

- **Supabase:** org "Akos Digital Services" `yvbawszeinuuwbzljnrc`, project
  `international-rentals` `jhjzcrypzpvevxouuejm`, **free plan** (auto-pauses after 7 days
  idle — see §1 of `docs/07-SEASON-ROUTINE.md`)
- **Railway:** project **"International Rent-a-Car App"** `2b682009-3b3f-44b2-a4fd-07e84e2c48b7`,
  one `production` environment, three services: `international` (the app), `keep-alive`,
  `purge-licences`
- **GitHub:** `https://github.com/m-a-v-r-o-s/international.git`, branch `master`, CI in
  `.github/workflows/ci.yml` (test · typecheck · build · audit, no secrets needed)

---

## Part 2 — What is open on International

The authority is `docs/01-DECISIONS.md`; `docs/06-IMPLEMENTATION-NOTES.md` has the long-form
"Not done, and where it belongs" list. This is the triage view of it.

### 2.1 Where the build stands

Phases 0–6 are in. 510 tests. Built: schema + RLS + the two engines, the rep booking core
(R1–R8), admin A1–A6 and A8–A10, A13 (car relocations, the newest work), pickup/return,
contract PDF + signature, licence OCR, retention purge, audit viewer, CI, WCAG pass, load
test. Provisioned against the real Supabase project with the migrations applied unmodified.

**A7 (reports + CSV export) is the only screen in the inventory still unbuilt**, deliberately
deferred until the pilot produces real data.

### 2.2 Blocking, in priority order

1. **`{{ .Token }}` in the magic-link email template — the boss cannot sign in.** Blocked
   behind custom SMTP or a paid Supabase plan. Highest-priority item in the project: it is
   the difference between the October pilot happening and not.
2. **Client item 8 — domain + Google Play developer account.** This one item blocks: the
   email-first receipts (§44 hard-depends on it), `mailer.ts` ever sending anything, the TWA
   wrapper / Play listing / `manifest.webmanifest`, Core Web Vitals on a real device, and
   `site_url` + the redirect allow-list (both still `localhost`).
3. **The accountant's ruling on q2** — may retail be issued through a πάροχος and this
   business's ΦΗΜ stood down. Pivotal; a vendor cannot close it. Questionnaire is live at
   `/accountant-questionnaire` and published as an artifact (see memory 6 for the share-pin
   gotcha after any edit).
4. **Client items 1–7** — category names, model specs incl. tank litres, the 100-car fleet
   CSV (`scripts/import-fleet.ts` is ready), price tables, the paper agreement's terms,
   hotel list + rep assignments (no longer blocking — A8 exists), company legal details.
   Items 5 and 7 are what keep every contract stamped DRAFT and unsignable.

### 2.3 Open questions owned by other people

- **Owner:** does a corporate client pay at handover, or is it invoiced and settled later?
  If the latter the B2B path needs `payment_method_type: 1` and a receivables/settlement
  state the design does not have.
- **Owner:** which of the four POS terminals a card handover names — a rep's choice at
  payment, or inferred from who/where they are. **Wants deciding before the pickup screen is
  designed, not after.**
- **Accountant:** the deferred-issuance date ruling (a document issued on reconnect can cross
  a month boundary and land in the wrong VAT period), plus Q7 (11.2 ΑΠΥ), Q8 (income
  classification), Q15 (correction window).
- **Wrapp, in writing:** a billing book for **5.1** (B2B credit note — the set has 11.2, 2.1
  and 11.4, so a wrong ΤΠΥ currently has nothing to correct it with); the three undocumented
  response fields (`authentication_code` sync from `POST /invoices`; `transaction_id` /
  `card_type` / `card_number` on the `issued-invoice` webhook); whether any test facility
  exists for the Worldline and epay terminals; portal/PDF link lifetimes; any cap on
  `customer_emails`; confirmation of no rate limit. **Also: ask them to revoke the unasked-for
  Partners Onboarding key** — it is deliberately stored nowhere in this project.
- **Still open from §29:** minimum rental length (assumed 1 day), maximum forward booking
  window (assumed none).

### 2.4 ΑΑΔΕ / Wrapp — the traps, since none of it is built yet

Nothing of issuance exists in code. When it gets built, behind a provider-agnostic seam:

- **ΦΠΑ is 17%, not 24%.** Every sample payload Wrapp supplied says 24. Κως is a reduced-rate
  island. 24 is a *recognised* value, so it validates, issues and transmits with the wrong
  tax on it. The rate is asserted as 17 before the call, and anything else is a refusal, not
  a fallback. Never taken from an example, a default or a response.
- Wrapp **stores** amounts, never computes them. The net/VAT derivation from a gross whole
  euro, and the requirement that the parts sum back to the gross to the cent, are ours alone.
- A **card** handover has **no document at the moment of payment**, by design: `my_data_mark`,
  `my_data_uid` and `my_data_qr_url` come back empty and the σήμανση only exists once the
  card is presented. Success arrives as the `issued-invoice` webhook, failure as
  `pos-payment`. This applies to every card rental, not a slow minority.
- **Never test against a client's live terminal** — the money leg is real. Demo path is
  Viva-only, so the Πειραιώς softPOS (the connectivity-weakest point in the design) gets its
  first real exercise at cutover. Name it on the cutover checklist.
- Cutover = **four `pos_devices` across three acquirers**, `authorization_code`s that look
  single-use. Four checklist items with named owners, not one line.

### 2.5 Code-level loose ends (small, known, none urgent)

- `handovers.by_profile` and a direct `cash_handovers` insert — a rep can write something
  untrue about who did what. Neither moves a figure. Worth an hour.
- Six `app` functions without an explicit `search_path` (`rental_days`, `today`,
  `touch_updated_at`, `audit_redact`, `window_from`, `window_to`). One line each; the repo's
  own rule says every function sets it.
- `auth_rls_initplan` on ten policies — the `(select auth.uid())` rewrite. Touches
  `bookings_select`/`bookings_update`, so it wants the isolation suite run against it as its
  own change.
- Five CHECK-constrained columns that want to be real enums (`car_models.transmission`,
  `.fuel_type`, `handovers.kind`, `damage_marks.view`, `.mark_type`).
- Fingerprint/WebAuthn unlock — §21 offered "PIN or fingerprint"; only the PIN is built.
- A push has never arrived on a real phone; an email has never actually been sent. Both are
  complete and unexercised. Pilot phones in October.
- No backups / PITR on the free plan. Hard pre-production item for a database of scanned
  licences.
- **Doc fix:** `HANDOFF.md` still says *"Money is integer cents."* That was reversed on
  1 Sep 2026 — it is whole euros now, with the one carve-out inside the document builder.
  The stale line should be corrected before anyone reads `HANDOFF.md` cold.

### 2.6 Standing rules that are easy to get wrong from memory

- **Commit, never push.** Commits authored as `m-a-v-r-o-s`, no Claude/Anthropic trailer.
- A day is **inclusive** — `+ 1`, never `end - start`.
- A rep never sees an aggregate (except their own cash today); price is server-side only;
  eligibility is a hard block the admin alone overrides.
- Greek **and** English from the first commit; no hard-coded user-facing strings.
- The customer ledger has **no retention window** by explicit, twice-confirmed decision. Do
  not re-litigate it — just make sure the agreement gains a matching clause when the real
  terms arrive.
- Wrapp's API docs are published as machine-readable markdown at
  `https://wrapp.ai/api/documentation.md` — read that, not the HTML page.

---

## Part 3 — First ten minutes on the PC

1. `git pull` in the repo.
2. Copy `.env.local` across (1.6), and the six memory files (1.2).
3. Diff `~/.claude/CLAUDE.md` against the laptop's reconstruction — merge, don't clobber.
4. Confirm the `supabase` plugin is installed and the `cloudflare` / `railway` / `resend`
   MCP servers exist at user scope; re-auth `supabase` via `/mcp` if it is asking.
5. `npm ci` then `npm test` — 510 tests, no network needed. If it dies at startup, suspect
   `scripts/fix-embedded-pg-libs.mjs`, not the SQL.
6. Read `docs/01-DECISIONS.md` §43, §44 and §45 before touching anything tax- or fleet-related.
