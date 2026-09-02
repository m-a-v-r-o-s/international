/**
 * The scheduled notifications (docs/01-DECISIONS.md §22).
 *
 *   npm run notify -- --incidents    the boss's inbox: anything not yet told
 *   npm run notify -- --morning      each rep's own pickups today
 *   npm run notify -- --evening      each rep's own returns due today
 *
 * On Railway these are cron services against the same project. The incidents
 * sweep wants a short interval (every few minutes) because damage reported at a
 * hotel desk is news; the two rep digests want one run each, at whatever time
 * the boss decides counts as morning and evening — the app deliberately does
 * not hold those hours, because a cron expression is where a schedule belongs
 * and inventing a second copy of it in app_settings would let the two disagree.
 *
 * Runs on the service role, so it needs SUPABASE_SERVICE_ROLE_KEY,
 * NEXT_PUBLIC_SUPABASE_URL and the two VAPID keys. With no VAPID keys it exits
 * 0 having sent nothing and says so — the same posture as the mailer with no
 * SMTP. A missing optional integration is not a failed job.
 */
import {
  notifyEveningReturns, notifyMorningPickups, notifyPendingIncidents,
} from '../src/lib/push/notify'

const modes = ['incidents', 'morning', 'evening'] as const
const mode = modes.find((m) => process.argv.includes(`--${m}`))

if (!mode) {
  console.error(`Pass one of: ${modes.map((m) => `--${m}`).join(', ')}`)
  process.exit(1)
}

const outcome = mode === 'incidents'
  ? await notifyPendingIncidents()
  : mode === 'morning'
    ? await notifyMorningPickups()
    : await notifyEveningReturns()

if (!outcome.configured) {
  console.log('Push is not configured (no VAPID keys). Nothing was sent.')
  process.exit(0)
}

console.log(`${mode}: sent ${outcome.sent}, expired ${outcome.expired}, failed ${outcome.failed}`)
if ('announced' in outcome) console.log(`  incidents marked as told: ${outcome.announced}`)

// A failed send is not a reason to fail the job — the next run will try the
// endpoints that are still alive — but it should be visible in the cron log.
process.exit(0)
