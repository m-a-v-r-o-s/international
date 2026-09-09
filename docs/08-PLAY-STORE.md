# Play Store publication

**Read `HANDOFF.md` and `docs/01-DECISIONS.md` §23 before this file.** The platform
decision is already made and is not reopened here: a Next.js app wrapped as a Trusted Web
Activity, Android only, the boss additionally on desktop.

This file is the execution plan for getting that wrapper into the Play Store. It is split
three ways on purpose:

| Part | Who | Blocked on |
|---|---|---|
| **A** | an agent, today | nothing |
| **B** | an agent | the domain (client item 8) |
| **C** | Akos, in a browser | Google, and the client |

Part A is roughly a day of work and none of it is wasted if the domain slips again. Part C
contains the long pole: Play account verification takes days on its own and is independent
of everything else, so **start it now, in parallel**.

---

## 0. The decision that sets the shape

**Akos must answer this before Part C, and it changes nothing in Part A or B.**

The business has one boss and 6 to 10 seasonal reps. That is 11 people, and it means the
production track is probably the wrong target.

| Track | Reach | Review | 12-tester rule |
|---|---|---|---|
| **Internal testing** | 100 testers, added by Google account email | minutes | does not apply |
| Closed testing | tester lists or groups | light | this is the rule |
| Production | public listing | full, days | 12 testers opted in for 14 continuous days, first |

A personal developer account created after 13 Nov 2023 cannot apply for production access
until it has run a closed test with 12 testers opted in **continuously** for 14 days. One
tester dropping out on day 7 resets the counter. With 11 real users that policy is being
satisfied rather than used.

**Recommendation: internal testing track, on an organization account.**

- Internal testing installs from a Play link like any other app, auto-updates, holds 100
  testers and is permanent. It is not a lesser version of shipping, it is the right track
  for a staff tool.
- An **organization** account costs the same $25 but needs a D-U-N-S number for Akos
  Digital Services. It sidesteps the 12-tester prerequisite entirely if production is ever
  wanted later, and it puts the company name on the listing instead of Akos's home address,
  which a personal account publishes.

Production stays available later without rebuilding anything. The AAB is identical; only
the track changes.

---

## Part A — an agent can do all of this today

No domain, no Play account, no client data needed. Work in this order.

### A1. `public/manifest.webmanifest`

Bubblewrap reads this file and generates the whole Android project from it, so its values
become the app's values. Create it as a static file in `public/`.

```json
{
  "name": "International Rentals",
  "short_name": "IR Ops",
  "description": "Operations app for International Rentals staff.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f4f6f8",
  "theme_color": "#10456a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Four things about those values, each deliberate:

- **`theme_color` is `#10456a`** and `background_color` is `#f4f6f8`. Both are lifted from
  `src/app/globals.css` (`--color-brand`, `--color-canvas`) and `theme_color` already
  matches the `viewport` export in `src/app/layout.tsx`. Do not invent a third blue.
- **`start_url` is `/`, with no locale prefix.** Language comes from `profiles.lang`
  through a cookie, never from the URL (§24, and the i18n note in
  `docs/06-IMPLEMENTATION-NOTES.md`). A start URL with `/el` baked into it would be wrong
  for bilingual staff and would hand every rep the boss's language or the reverse.
- **The strings are hard-coded English here and that is correct.** A manifest is one static
  file served before any session exists, so there is no user to have a language. It is not
  a violation of the no-hard-coded-strings rule, it is outside that rule's reach. Keep the
  values identical to `messages/en.json` `app.name` / `app.short` / `app.description` so
  they cannot drift.
- **`display: "standalone"`**, not `fullscreen`. The rep needs the clock and the battery
  while a guest waits.

Then wire it into the metadata in `src/app/layout.tsx`, next to `icons`:

```ts
manifest: '/manifest.webmanifest',
```

**No proxy change is needed.** The matcher in `src/proxy.ts` already excludes any path
ending in a file extension, and `.webmanifest` is one. Verify that rather than assume it
(A4).

### A2. PNG icons

`src/app/icon.svg` is the only icon in the repo and Bubblewrap will not accept an SVG.
Generate three PNGs into `public/`:

| File | Size | Notes |
|---|---|---|
| `icon-192.png` | 192×192 | manifest |
| `icon-512.png` | 512×512 | manifest, and the Play listing icon |
| `icon-maskable-512.png` | 512×512 | manifest, `purpose: maskable` |

**`sharp` is already in `node_modules`** (Next pulls it in). Use it, do not add a
dependency and do not install ImageMagick.

The maskable one is not the same image resized. Android crops a maskable icon to whatever
shape the launcher uses, and only the centre 80% circle is guaranteed to survive. The
current SVG is a rounded square that fills its own viewBox edge to edge, so cropping it
takes the corners off the badge. Produce the maskable variant by painting a full-bleed
`#10456a` field and compositing the wheel mark at about 60% scale, centred. Look at the
output as an image before moving on.

### A3. `tests/unit/manifest.test.ts`

One small test, in the shape of `tests/unit/messages-parity.test.ts`: parse
`public/manifest.webmanifest`, assert the required Bubblewrap fields are present, assert
every `icons[].src` resolves to a file that actually exists in `public/`, and assert
`name` / `short_name` / `description` still equal `messages/en.json`'s `app.*`.

That is the whole test. It catches the two failures that would otherwise surface as a
rejected Play upload weeks later: a renamed icon, and a manifest that drifted from the app
it names. No test for the PNG contents, that is what looking at them is for.

### A4. Prove the files are actually served

The one real risk in A1 is a manifest that 307s to `/login`, which would fail Bubblewrap
with a confusing error. Test it, do not reason about it.

Start the dev server on **port 3001** (never 3000, see the global rules; if another agent
holds 3001, take 3002) and check all four paths return 200 with no session cookie:

```
curl -sI localhost:3001/manifest.webmanifest
curl -sI localhost:3001/icon-192.png
curl -sI localhost:3001/icon-512.png
curl -sI localhost:3001/icon-maskable-512.png
```

Expect `200` and `content-type: application/manifest+json` on the first. A `307` means the
proxy matcher caught it and A1's assumption was wrong.

### A5. A listing seed, separate from the dev seed

Store screenshots cannot be taken against `supabase/seed/dev-seed.sql`. Every category in
it is literally named `Category A — PLACEHOLDER`, which is right for engine tests and
unusable in a public image.

Write `supabase/seed/listing-seed.sql` alongside it, with the same top-of-file warning
about not running it against production. It must satisfy both standing rules at once:

- **No client data, ever, in a public image.** The real fleet, hotels and prices have not
  arrived (client items 1 to 6) and must not appear even after they do.
- **Invented but locally plausible.** Cretan plate prefixes (ΗΡ Heraklion, ΧΝ Chania, ΡΕ
  Rethymno, ΑΝ Lasithi), real-sounding hotel names for the market, category names a Greek
  rent-a-car would actually use, prices in a believable August band. Roughly 20 cars across
  4 or 5 categories and a dozen bookings spread over a fortnight is enough to make a screen
  look like a working day rather than a demo.

Note in the file header that it exists for store assets only and is not part of the test
fixtures.

### A6. Screenshots

Run the app locally against the listing seed and capture with Playwright at a phone
viewport (412×915, `deviceScaleFactor: 2`, which lands at 824×1830 and clears Play's
requirement that each side sits between 320 and 3840 px).

Play needs a minimum of 2 phone screenshots. Take **4**, because 4 is the threshold for
being eligible for promotional surfaces, and it costs nothing now.

Shoot the four screens that show what the app is:

1. Availability (R2), the answer to "is there a car"
2. New booking (R3), the thing reps do twenty times a day
3. Pickup (R4) with the damage diagram, the paper this replaces
4. The admin movements sheet (A1), the boss's morning

Take them in **English**, and take the same four in **Greek** if the listing is going to be
localised (Part C decides that). Look at every one as an image before accepting it, per the
standing marketing process: a screen with an empty bottom third or a clipped control is a
reshoot, not a crop.

### A7. Feature graphic, 1024×500

Required by Play, and it is the one asset with no equivalent anywhere in the repo. Build it
the way every other piece of marketing material here is built: **one HTML file, rendered
headless at 2× and supersampled down**, not a design tool. Dark ground, the brand blue, the
wheel mark, the product name, no decorative grid overlay and no radial glow. Export PNG.

Put it and the screenshots under `assets/play/`, next to the existing `assets/portfolio/`.

### A8. Draft the listing copy

Write `assets/play/listing.md`, in the shape of the companion `.md` the marketing process
already calls for: the text ready to paste, in both languages, with character counts
against Play's limits.

| Field | Limit |
|---|---|
| App name | 30 |
| Short description | 80 |
| Full description | 4000 |

This is an internal staff tool with `robots: noindex`, so the copy has no SEO job at all.
It is read by exactly two audiences: a Play reviewer deciding what the app is, and a rep
who was told to install it. Write for those two and nobody else. No keyword stuffing.

### A9. Draft the Data Safety answers

The heaviest form in Part C, and the one an agent can genuinely prepare because the answers
are all derivable from the schema and §25. Write them into `assets/play/data-safety.md` as
a question-and-answer list Akos can transcribe.

Walk `db/schema.sql` and enumerate honestly. At minimum this app collects: name, date of
birth, driving licence number, **photographs of a driving licence**, a handwritten
signature, and phone or email where the contract is delivered. Government ID and photos are
both sensitive categories under Play policy and both must be declared.

For each: collected yes, shared **no**, encrypted in transit yes, and deletion available.
The retention answer is §25 and the mechanism is `src/lib/retention/purge.ts`, so it is a
fact and not a promise: licence images auto-delete on an admin-set window defaulting to 24
months after the rental ends, and every purge is logged.

**Getting this form wrong is a takedown, not a warning.** Do not soften anything, and do
not answer "no" to a category because answering "yes" invites questions.

### A10. Optional but recommended: a throwaway Bubblewrap run

Nothing about the toolchain has ever been exercised on this machine. There is no JDK
installed. Bubblewrap offers to download a JDK and the Android SDK into `~/.bubblewrap` on
first run, which is a large download and better discovered now than on the afternoon the
domain lands.

Run it against the existing Railway testing origin purely to prove the chain:

```
npx @bubblewrap/cli init --manifest https://international-testing.up.railway.app/manifest.webmanifest
```

The single thing to verify in the generated `twa-manifest.json`:

> **`targetSdkVersion` must be 36.** Since 31 Aug 2026 Play refuses new apps and updates
> that target below Android 16 (API 36). An older Bubblewrap emits 34 or 35 and the upload
> is rejected with a message that does not obviously say why. If it emits the wrong value,
> fix it in `twa-manifest.json` and confirm it survives into the generated Gradle config.

Then **delete the generated project**. It is bound to the wrong origin and must not be
committed or reused. Record the Bubblewrap version and the targetSdk it produced in
`docs/06-IMPLEMENTATION-NOTES.md`, so the real run in Part B starts from a known answer.

### A11. Update the docs this supersedes

- `docs/06-IMPLEMENTATION-NOTES.md`, deferred list: the manifest is no longer deferred.
  Rewrite that bullet to say what is now done and what is left (asset links and the wrapper,
  both genuinely domain-bound).
- `docs/05-BUILD-PLAN.md`, Phase 5: point its one-line "TWA wrapper, Play Store listing and
  internal-testing track" at this file.

---

## Part B — waits for the domain, then takes an afternoon

Do not start any of this early. Digital Asset Links verification is bound to an exact
origin, so building against `international-testing.up.railway.app` and re-pointing later
means a new AAB, a new asset statement and a fresh upload.

### B1. Settings that must move off localhost first

| Where | Setting | Currently |
|---|---|---|
| Railway | `NEXT_PUBLIC_SITE_URL` | falls back to the testing domain |
| Supabase auth | `site_url` | `http://localhost:3000` |
| Supabase auth | `uri_allow_list` | empty |

`docs/06-IMPLEMENTATION-NOTES.md` already flags all three. They are deliberately
provisional and all three must be correct before a TWA exists, or the boss's magic link
lands on localhost.

### B2. Bubblewrap, for real

```
npx @bubblewrap/cli init --manifest https://<domain>/manifest.webmanifest
npx @bubblewrap/cli build
```

Check `startUrl` is `/` and `targetSdkVersion` is 36 before building. The build produces an
`.aab` for Play and an `.apk` for direct testing.

**The keystore Bubblewrap generates is the one irreplaceable artifact in this entire
process.** It is not in the repo and must never be committed. Hand the file and its two
passwords to Akos immediately, and say plainly that losing them means never being able to
update that listing again.

### B3. `public/.well-known/assetlinks.json`, and the mistake everyone makes

This file is what stops the app opening with a Chrome address bar across the top, looking
like a browser instead of an app.

It must carry the SHA-256 fingerprint of the key that **actually signs the installed app**.
Bubblewrap signs with the upload key, and then Play App Signing re-signs with a key Google
holds. Ship only the upload fingerprint and verification fails on every real install while
working perfectly on the local APK, which is exactly the shape of bug that eats a day.

So the order is fixed and cannot be shortened:

1. Build, and upload the AAB to Play once (Part C).
2. Read the **app signing key** SHA-256 from Play Console, Setup, App integrity.
3. Put **both** fingerprints in `assetlinks.json`, Google's and the upload key's.
4. Deploy that file to Railway.
5. Only then install from Play and check for the absence of a URL bar.

Do not create this file with a placeholder fingerprint in the meantime. An
invented-looking value in the repo is worse than an absent one, and this project has
already made that call once about `site_url`.

`src/proxy.ts` needs no change: the path ends in `.json`, which its matcher excludes.

---

## Part C — only Akos can do these

Ordered by how long they take to come back, not by when they are needed.

### Start immediately, in parallel with Part A

1. **Decide personal or organization** (section 0). Organization needs a D-U-N-S number for
   Akos Digital Services, which is free but can take up to 30 business days if the company
   does not already have one. **This is the longest pole in the plan.** Check first whether
   one already exists.
2. **Register the Play developer account**, $25 one-time, and complete identity and address
   verification. Days, sometimes longer, and entirely independent of the app.
3. **Chase client item 8 from the client: the domain.** Say it in these terms, because the
   Play Store is the smaller half of it: the same missing domain is blocking custom SMTP,
   and custom SMTP is what is blocking **the boss being able to log in at all**
   (`docs/06-IMPLEMENTATION-NOTES.md`, the `{{ .Token }}` item). The domain is not a
   nice-to-have, it is the difference between the boss opening the app in October and not.
4. **Collect the reps' Google account emails.** Internal testing adds testers by Google
   account, so a rep with only an Apple or a Microsoft address cannot be added. Worth
   discovering now rather than on install day.

### Once the domain exists

5. Point the domain at Railway, then confirm B1's three settings are set.
6. Store the keystore and its passwords somewhere that is not the laptop. A password
   manager entry, not a folder.

### In Play Console, once the account is verified

7. Create the app, upload the AAB to the **internal testing** track.
8. **App access.** Do not skip this one. Every screen in this app is behind a login, so a
   reviewer without credentials sees a login wall and rejects it. Provide a working demo
   rep account against seed data, and note in the field that the app is an internal staff
   tool with no public signup.
9. **Data safety form.** Transcribe A9. This is the one to slow down on.
10. Content rating questionnaire, target audience (adults), ads declaration (none),
    financial features (none: cash is recorded, never processed, and the Wrapp POS is out
    of band).
11. Privacy policy URL: `https://<domain>/privacy`. The page exists and is public.
12. Upload the assets from A6 and A7 and paste the copy from A8.
13. Add the reps as internal testers, send the link, and install on one real phone.
14. Read the app signing SHA-256 back out and hand it to the agent for B3.

---

## Definition of done

- [ ] The manifest and all three icons are served with 200s and no session (A4)
- [ ] `npm run test` passes, including the new manifest test
- [ ] The maskable icon has been looked at as an image, not just generated
- [ ] Screenshots contain no client data, and no string reading `PLACEHOLDER`
- [ ] `targetSdkVersion` is 36 in the built project
- [ ] `assetlinks.json` carries the Play App Signing fingerprint, not only the upload key
- [ ] The installed app opens with no URL bar, on a real Android phone
- [ ] The keystore and its passwords are in Akos's hands and off this machine
- [ ] A rep who is not Akos has installed it from the Play link and signed in with a PIN
