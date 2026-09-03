/**
 * A heartbeat for the free-tier Supabase project (docs/07-SEASON-ROUTINE.md §1).
 *
 *   npm run keep-alive
 *
 * A free-tier Supabase project auto-pauses after 7 days with no API activity,
 * which would take the boss's own login down with it. This used to be a side
 * effect of the notification crons — every one of them made a real Supabase
 * RPC call before checking whether there was anything to send — but 0036
 * removed push notifications outright (docs/01-DECISIONS.md §22 is
 * superseded), and the free-tier project still needs something firing on a
 * schedule well inside 7 days.
 *
 * This does nothing else. One cheap, authenticated read against a row that
 * always exists — enough to count as activity, nothing worth a failure mode
 * of its own. On Railway this replaces the old `notify-incidents` cron, on
 * the same 5-minute cadence; see docs/07-SEASON-ROUTINE.md.
 */
import { supabaseAdmin } from '../src/lib/supabase/admin'

const { error } = await supabaseAdmin().from('app_settings').select('id').eq('id', 1).maybeSingle()

if (error) {
  console.error('keep-alive: read failed:', error.message)
  process.exit(1)
}

console.log('keep-alive: ok')
