'use server'

import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import {
  hashPin, isChosenPinLength, isPredictablePin, verifyPin,
} from '@/lib/auth/pin'
import { requireStaff } from '@/lib/auth/session'
import { openUnlockWindow, requestIpHash } from '@/lib/auth/signin'

export type ChangePinState = {
  error?:
    | 'wrong' | 'rateLimited' | 'length' | 'weak' | 'mismatch' | 'digitsOnly'
    | 'reused' | 'unknown'
  done?: boolean
}

const pinSchema = z.string().trim().max(32)

/**
 * A rep replaces the PIN they are holding with one of their own
 * (docs/01-DECISIONS.md §38).
 *
 * WHY THE CURRENT PIN IS ASKED FOR, including on the forced first use where the
 * rep typed it into the login screen a few seconds earlier and it therefore
 * looks like the ceremony §32 objected to.
 *
 * It is not the same thing. §32 was about a second CREDENTIAL — a password in
 * front of a PIN, two secrets for one door. This is one secret, asked for at the
 * moment it is being replaced, which is what every credential change asks for
 * and for a reason that is very concrete here: this screen is reachable for as
 * long as the shift-length unlock window is open, and the device it is open on
 * is a phone lying on a hotel front desk. Without this field, walking past an
 * unattended, unlocked phone is enough to take the account — set a PIN, and the
 * rep is now locked out of a credential someone else chose. With it, the person
 * at the desk has to already know the PIN, at which point they have the account
 * anyway and nothing was protected by the change screen either way.
 *
 * requireStaff() and not requireUnlocked(): the latter is what redirects a rep
 * HERE, so calling it here is a loop. The unlock gate is not being skipped —
 * this action verifies the same PIN that screen would ask for, and opens the
 * same window when it matches.
 */
export async function changePin(
  _prev: ChangePinState, formData: FormData,
): Promise<ChangePinState> {
  const staff = await requireStaff()
  // The boss has no PIN by design (§21), so there is nothing here for him to
  // change. The page redirects him before he sees the form; this is the same
  // answer for a POST that arrives without one.
  if (staff.role !== 'rep') return { error: 'unknown' }

  const current = pinSchema.safeParse(formData.get('current'))
  const pin = pinSchema.safeParse(formData.get('pin'))
  const confirm = pinSchema.safeParse(formData.get('confirm'))
  if (!current.success || !pin.success || !confirm.success) return { error: 'unknown' }

  // Everything that can be decided from what was typed is decided FIRST, before
  // the rate limiter is touched. A rep who fat-fingers the confirmation field
  // has not made an attempt at anybody's PIN, and spending one of six guesses on
  // it would mean a rep could lock themselves out of their own phone by mistyping
  // a form — on the one screen they cannot leave.
  if (!/^\d*$/.test(pin.data)) return { error: 'digitsOnly' }
  if (!isChosenPinLength(pin.data)) return { error: 'length' }
  if (isPredictablePin(pin.data)) return { error: 'weak' }
  if (pin.data !== confirm.data) return { error: 'mismatch' }

  const ipHash = await requestIpHash()

  // The SAME bucket the unlock screen uses, deliberately, rather than one of its
  // own. Both screens verify the same secret and hand back the same yes-or-no,
  // so two buckets would mean a person with an unlocked phone gets six guesses
  // at the PIN on one screen and six more on the other — a second oracle against
  // the same hash, which is precisely what a per-screen limit should not create.
  if (!(await allow(`unlock:${staff.id}`, 6, 300))) {
    await logSecurityEvent({ kind: 'pin_rate_limited', profileId: staff.id, ipHash })
    return { error: 'rateLimited' }
  }

  const { data } = await supabaseAdmin()
    .from('profiles').select('pin_hash').eq('id', staff.id).maybeSingle()

  const stored = (data as { pin_hash: string | null } | null)?.pin_hash ?? null

  if (!(await verifyPin(current.data, stored))) {
    await logSecurityEvent({ kind: 'pin_failed', profileId: staff.id, ipHash })
    return { error: 'wrong' }
  }

  // Only meaningful once the field above has been proved to hold the real PIN.
  // Asked before that, "you are already using that one" is a sentence about a
  // string the person mistyped, and it would be shown instead of "that PIN did
  // not match" — the wrong reason, for the wrong field.
  if (pin.data === current.data) return { error: 'reused' }

  // p_boss_issued: false is the whole point of the screen — it is what clears
  // pin_must_change and stops the prompt coming back. The rep never writes the
  // column: this is the service role calling the same function the boss's
  // re-issue calls, with the other answer.
  const { error } = await supabaseAdmin().rpc('set_pin_hash', {
    p_profile_id: staff.id,
    p_hash: await hashPin(pin.data),
    p_boss_issued: false,
  })
  if (error) return { error: 'unknown' }

  await logSecurityEvent({ kind: 'pin_changed', profileId: staff.id, ipHash })

  // They proved the old PIN a moment ago and chose the new one, so the shift
  // window starts again here rather than sending them to /unlock to type the
  // PIN they have just this second finished setting.
  await openUnlockWindow(staff.id, staff.role)

  // Not a redirect: this screen is the confirmation. A rep who was FORCED here
  // has no page they were trying to reach to be returned to, and one who came
  // from settings deliberately should be told it worked rather than silently
  // put back where they started.
  return { done: true }
}
