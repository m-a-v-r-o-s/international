/**
 * The licence-image retention purge, for a scheduler (docs/01-DECISIONS.md §25).
 *
 *   npm run purge:licences           delete what is due
 *   npm run purge:licences -- --dry  report what would go, delete nothing
 *
 * Runs on the service role, so it needs SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SUPABASE_URL in the environment and nothing else. On Railway
 * this is a cron service against the same project, scheduled monthly
 * (00:00 on the 1st) since the retention window is measured in months. The
 * cutoff in licence_images_due_for_purge() is absolute, not since-last-run,
 * so a monthly cadence still catches everything that fell due in between.
 *
 * The same function backs the "Purge now" action on A10, so the scheduled run
 * and the boss's button do exactly the same thing.
 */
import { purgeLicenceImages } from '../src/lib/retention/purge'

const dryRun = process.argv.includes('--dry')

const outcome = await purgeLicenceImages({ dryRun })

console.log(dryRun ? 'Dry run — nothing was deleted.' : 'Purge complete.')
console.log(`  licence images ${dryRun ? 'due' : 'deleted'}: ${outcome.deleted}`)
console.log(`  bookings:                 ${outcome.bookings}`)
if (!dryRun) console.log(`  drivers marked purged:    ${outcome.driversMarked}`)
if (outcome.refused > 0) console.log(`  REFUSED by the path check: ${outcome.refused}`)
if (outcome.failed > 0) {
  console.error(`  batches that failed:      ${outcome.failed}`)
  process.exit(1)
}
