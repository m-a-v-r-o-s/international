import 'server-only'

import { supabaseAdmin } from '../supabase/admin'
import { translate } from './messages'
import { sendEach, targetsFor, type PushMessage, type SendOutcome, type Target } from './send'

/**
 * The three notifications docs/01-DECISIONS.md §22 asks for, and no others.
 *
 *   · Admin, on an incident:    whatever a rep found and sent in.
 *   · Rep, in the morning:      their own pickups today (plus any return due
 *                               today, since that shift is the only chance to
 *                               catch one that falls outside the usual
 *                               evening-shift pattern).
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

  // The morning push also flags any return due today. Returns are normally
  // an evening-shift thing, but the rare one that falls in the morning shift
  // needs to reach a rep before the shift ends — the evening digest at 17:30
  // would be hours too late for it.
  const returnsToo = kind === 'pickup' ? all.filter((m) => m.kind === 'return') : []

  // Nothing on today is silence, not an empty notification. A push that says
  // "no pickups" every morning is a push a rep turns off in a week.
  if (mine.length === 0 && returnsToo.length === 0) return null

  const key = kind === 'pickup' ? 'morning' : 'evening'
  const sections = [
    mine.length > 0 ? lines(mine) : null,
    returnsToo.length > 0
      ? `${translate(target.lang, 'push.morning.alsoReturns')}\n${lines(returnsToo)}`
      : null,
  ].filter((section): section is string => section !== null)

  return {
    // A morning digest with no pickups at all, only a stray return, reads as
    // what it actually is rather than borrowing the pickups title.
    title: translate(target.lang, `push.${mine.length > 0 ? key : 'evening'}.title`),
    body: sections.join('\n\n'),
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

/** As much of a rep's note as fits on a lock screen beside the reference. */
const NOTE_CHARS = 40

function firstLine(note: string | null): string {
  const line = (note ?? '').split('\n')[0]?.trim() ?? ''
  if (line.length <= NOTE_CHARS) return line
  return `${line.slice(0, NOTE_CHARS - 1).trimEnd()}…`
}

/**
 * Incidents the boss has not been told about yet.
 *
 * Swept rather than pushed from the place each one is raised. Today there is
 * one such place — a rep sending one in from /incidents — and the sweep is
 * kept anyway: hanging a send off the raising code means the second path added
 * next year notifies nobody. `notified_at` is stamped only after the send, so
 * a failure leaves them pending rather than silently swallowed.
 *
 * They are stamped even when nobody is subscribed — otherwise the first person
 * to enable push would be greeted by every incident in the history of the
 * business.
 */
export async function notifyPendingIncidents(): Promise<SendOutcome & { announced: number }> {
  const admin = supabaseAdmin()

  const { data } = await admin.rpc('pending_incident_notifications', { p_limit: 50 })
  const pending = (data ?? []) as {
    id: string; note: string | null; booking_ref: string; plate: string
  }[]

  if (pending.length === 0) {
    return { configured: true, sent: 0, expired: 0, failed: 0, announced: 0 }
  }

  const targets = await targetsFor('incidents')

  const outcome = await sendEach(targets, (target) => {
    // The note is the rep's own words, in whichever language they wrote them —
    // so it is passed through rather than translated, with the reference and
    // plate beside it to say which car is being talked about.
    const body = pending.slice(0, MAX_LINES).map((e) =>
      [e.booking_ref, e.plate, firstLine(e.note)].filter(Boolean).join('  '))
    if (pending.length > MAX_LINES) body.push('…')

    return {
      // The boss may see an aggregate; §7's rule is about reps.
      title: translate(target.lang, 'push.incidents.title', { n: pending.length }),
      body: body.join('\n'),
      url: '/admin/incidents',
      tag: 'ir-incidents',
      lang: target.lang,
    }
  })

  // Only once the sending is done, and regardless of whether anybody was
  // listening — see above.
  const { data: marked } = await admin.rpc('mark_incidents_notified', {
    p_ids: pending.map((e) => e.id),
  })

  return { ...outcome, announced: typeof marked === 'number' ? marked : 0 }
}
