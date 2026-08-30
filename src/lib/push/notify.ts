import 'server-only'

import { supabaseAdmin } from '../supabase/admin'
import { translate } from './messages'
import { sendEach, targetsFor, type PushMessage, type SendOutcome, type Target } from './send'

/**
 * The three notifications docs/01-DECISIONS.md §22 asks for, and no others.
 *
 *   · Admin, on an exception:   damage flagged, car not returned, override.
 *   · Rep, in the morning:      their own pickups today.
 *   · Rep, in the evening:      their own returns due today.
 *
 * The rep messages LIST movements and never count them. §7 gives a rep exactly
 * one aggregate — their own cash in hand — and Phase 3 declined to put even a
 * count of today's pickups on R1, on the grounds that a count of rentals
 * starting today is a figure company revenue can be worked back from. "You
 * have 4 pickups today" would put back precisely what that decision left out.
 * A list is also what a rep actually wants on a lock screen.
 */
const MAX_LINES = 4

type Movement = {
  kind: 'pickup' | 'return'
  booking_id: string
  at: string | null
  plate: string
  guest: string | null
  room: string | null
}

function timeInAthens(at: string | null): string {
  if (!at) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(at))
}

/**
 * One line per movement, truncated by LINES and not by a count.
 *
 * "and 3 more" would be a number about a rep's own day, which is the thing
 * being avoided; "…" says there is more without saying how much.
 */
function lines(movements: Movement[]): string {
  const shown = movements.slice(0, MAX_LINES).map((m) => {
    const time = timeInAthens(m.at)
    const who = [m.guest, m.room].filter(Boolean).join(' · ')
    return [time, m.plate, who].filter(Boolean).join('  ')
  })
  if (movements.length > MAX_LINES) shown.push('…')
  return shown.join('\n')
}

async function movementsFor(profileId: string, on: string): Promise<Movement[]> {
  const { data } = await supabaseAdmin().rpc('rep_day_movements', {
    p_profile_id: profileId, p_on: on,
  })
  return (data ?? []) as Movement[]
}

/** Today in Athens, as a calendar date — the same day the database means. */
export function athensToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

async function repDigest(
  target: Target, kind: 'pickup' | 'return', on: string,
): Promise<PushMessage | null> {
  const all = await movementsFor(target.profile_id, on)
  const mine = all.filter((m) => m.kind === kind)

  // Nothing on today is silence, not an empty notification. A push that says
  // "no pickups" every morning is a push a rep turns off in a week.
  if (mine.length === 0) return null

  const key = kind === 'pickup' ? 'morning' : 'evening'
  return {
    title: translate(target.lang, `push.${key}.title`),
    body: lines(mine),
    url: '/',
    tag: `ir-${key}`,
    lang: target.lang,
  }
}

export async function notifyMorningPickups(on = athensToday()): Promise<SendOutcome> {
  const targets = await targetsFor('morning')
  return sendEach(targets, (target) => repDigest(target, 'pickup', on))
}

export async function notifyEveningReturns(on = athensToday()): Promise<SendOutcome> {
  const targets = await targetsFor('evening')
  return sendEach(targets, (target) => repDigest(target, 'return', on))
}

/**
 * Exceptions the boss has not been told about yet.
 *
 * Swept rather than pushed from the place each one is raised: an exception is
 * created by the return flow, by the pickup flow and by
 * public.admin_override_eligibility(), and hanging a send off each of those
 * means the fourth path added next year notifies nobody. `notified_at` is
 * stamped only after the send, so a failure leaves them pending rather than
 * silently swallowed.
 *
 * They are stamped even when nobody is subscribed — otherwise the first person
 * to enable push would be greeted by every exception in the history of the
 * business.
 */
export async function notifyPendingExceptions(): Promise<SendOutcome & { announced: number }> {
  const admin = supabaseAdmin()

  const { data } = await admin.rpc('pending_exception_notifications', { p_limit: 50 })
  const pending = (data ?? []) as {
    id: string; type: string; booking_ref: string; plate: string
  }[]

  if (pending.length === 0) {
    return { configured: true, sent: 0, expired: 0, failed: 0, announced: 0 }
  }

  const targets = await targetsFor('exceptions')

  const outcome = await sendEach(targets, (target) => {
    const body = pending.slice(0, MAX_LINES).map((e) =>
      `${translate(target.lang, `admin.exceptions.type.${e.type}`)}  ${e.booking_ref}  ${e.plate}`)
    if (pending.length > MAX_LINES) body.push('…')

    return {
      // The boss may see an aggregate; §7's rule is about reps.
      title: translate(target.lang, 'push.exceptions.title', { n: pending.length }),
      body: body.join('\n'),
      url: '/admin/exceptions',
      tag: 'ir-exceptions',
      lang: target.lang,
    }
  })

  // Only once the sending is done, and regardless of whether anybody was
  // listening — see above.
  const { data: marked } = await admin.rpc('mark_exceptions_notified', {
    p_ids: pending.map((e) => e.id),
  })

  return { ...outcome, announced: typeof marked === 'number' ? marked : 0 }
}
