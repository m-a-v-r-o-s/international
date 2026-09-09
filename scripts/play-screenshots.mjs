/*
  Play Store phone screenshots (docs/08-PLAY-STORE.md §A6).

    npx supabase start
    node scripts/play-seed-local.mjs
    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> \
    SUPABASE_SERVICE_ROLE_KEY=<local service> \
      npx next dev -p 3001 &
    node scripts/play-screenshots.mjs

  412x915 at deviceScaleFactor 2 lands at 824x1830, which clears Play's rule
  that both sides sit between 320 and 3840 px. It signs in through the real
  login and unlock screens rather than forging a cookie: a screenshot taken
  past a door the app would not actually open is a screenshot of something
  that does not exist.

  Four shots, in both languages, because those are the four screens that say
  what this app is:
    1 availability   is there a car
    2 new booking    the thing a rep does twenty times a day
    3 pickup         the paper this replaces, damage diagram and all
    4 movements      the boss's morning (admin)
*/
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { Client } from 'pg'
import { ACCOUNTS } from './play-seed-local.mjs'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3001'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const OUT = 'assets/play/screenshots'
const LOCALES = (process.env.SCREENSHOT_LOCALES ?? 'en,el').split(',')

const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

/**
 * What the two data-dependent shots point at, read out of the seeded database
 * rather than hard-coded, so a reseed does not silently produce a 404.
 *
 *  · the pickup already under way, which is the only one whose damage step is
 *    reachable (the step needs a pickup handover row to exist)
 *  · a car that is genuinely free over the range the booking form is opened
 *    with, so the form photographs part-filled the way a rep would see it
 *    rather than as an empty template
 */
async function targets() {
  const db = new Client({ connectionString: DB })
  await db.connect()

  const { rows: pickup } = await db.query(
    `select b.id
     from public.bookings b
     join public.handovers h on h.booking_id = b.id and h.kind = 'pickup'
     where b.kind = 'rental' and b.status = 'booked' and b.start_date = current_date
     order by b.ref limit 1`)

  const { rows: free } = await db.query(
    `select c.id,
            to_char(current_date, 'YYYY-MM-DD') as from_date,
            to_char(current_date + 4, 'YYYY-MM-DD') as to_date
     from public.cars c
     where c.archived_at is null
       and not exists (
         select 1 from public.bookings b
         where b.car_id = c.id
           and b.status in ('booked', 'out', 'blocked')
           and daterange(b.start_date, b.end_date, '[]')
               && daterange(current_date, current_date + 4, '[]'))
     order by c.plate limit 1`)

  await db.end()
  if (!pickup[0] || !free[0]) {
    throw new Error('seed does not have what the shots need: rerun scripts/play-seed-local.mjs')
  }
  return { pickupId: pickup[0].id, car: free[0] }
}

async function signIn(context, { email, password }, { pin } = {}) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#email', email)
  await page.fill('#credential', password)
  // The form's own submit, named explicitly: the page also carries a language
  // switcher whose buttons come last in the DOM.
  await page.locator('form:has(#credential) button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

  // A rep's device is locked between shifts; the admin's is never PIN-locked.
  if (pin && new URL(page.url()).pathname === '/unlock') {
    await page.fill('#pin', pin)
    await page.locator('form:has(#pin) button[type="submit"]').click()
    await page.waitForURL((url) => url.pathname !== '/unlock', { timeout: 30_000 })
  }
  return page
}

// The Next dev-server badge floats over the bottom-left corner of every page
// and would otherwise sit in the corner of every store screenshot. It lives in
// a <nextjs-portal> host element, so hiding the host is enough.
const HIDE_DEV_OVERLAY = 'nextjs-portal { display: none !important }'

async function shoot(page, path, file) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: HIDE_DEV_OVERLAY })
  // `networkidle` is not enough on its own: these routes stream, so it can fire
  // while loading.tsx's skeleton is still what is on screen and the shot comes
  // out as a stack of grey bars. Waiting for a heading does not work either,
  // because the app shell carries an sr-only one that is present throughout.
  // The skeleton's own class is the honest signal: it is gone exactly when the
  // screen's data has arrived.
  await page.waitForFunction(() => !document.querySelector('.ir-skeleton'), null,
    { timeout: 30_000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${file}.png` })
  console.log(`  ${file}.png  ${path}`)
}

mkdirSync(OUT, { recursive: true })
const { pickupId, car } = await targets()
const browser = await chromium.launch()

for (const locale of LOCALES) {
  console.log(`\n${locale}`)
  // The language is a cookie the layout reads, not a URL prefix (§24), so it
  // is set the same way the in-app switcher sets it.
  const cookie = { name: 'ir_locale', value: locale, url: BASE }

  const repCtx = await browser.newContext(PHONE)
  await repCtx.addCookies([cookie])
  const rep = await signIn(repCtx, ACCOUNTS.rep, { pin: ACCOUNTS.rep.pin })
  await repCtx.addCookies([cookie])
  await shoot(rep, '/availability', `${locale}-1-availability`)
  await shoot(rep,
    `/bookings/new?from=${car.from_date}&to=${car.to_date}&car=${car.id}`,
    `${locale}-2-new-booking`)
  // Straight to the damage diagram: the first step of a pickup is two file
  // pickers, and the diagram is the thing that replaces the paper.
  await shoot(rep, `/bookings/${pickupId}/pickup?step=damage`, `${locale}-3-pickup`)
  await repCtx.close()

  const adminCtx = await browser.newContext(PHONE)
  await adminCtx.addCookies([cookie])
  const admin = await signIn(adminCtx, ACCOUNTS.admin)
  await adminCtx.addCookies([cookie])
  await shoot(admin, '/admin/movements', `${locale}-4-movements`)
  await adminCtx.close()
}

await browser.close()
console.log('\nNow look at every one as an image, then run assets/play/render.sh to check sizes.')
