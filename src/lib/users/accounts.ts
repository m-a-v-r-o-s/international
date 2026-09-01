import 'server-only'

import { randomInt } from 'node:crypto'
import { supabaseAdmin } from '../supabase/admin'
import { logSecurityEvent } from '../rate-limit'
import { hashPin } from '../auth/pin'
import { sha256Hex } from '../hash'

/**
 * A8's one privileged operation: minting the account a rep signs in with.
 *
 * THIS IS A NEW CATEGORY OF SERVICE-ROLE USE, and it is worth saying why out
 * loud. Everywhere else the key is used for something the server does on its
 * own behalf — rate limiting, the security log, device binding, PIN storage.
 * Here it acts because the boss asked it to, which is the pattern
 * src/lib/supabase/admin.ts warns against. The reason it is nevertheless the
 * only option is that `auth.users` is GoTrue's table and not ours: an insert
 * into it is refused for `authenticated` AND for `service_role` alike, and
 * PostgREST does not expose the `auth` schema at all. There is no policy that
 * could be written, no grant that could be given, and no SECURITY DEFINER
 * function that could stand in — the GoTrue Admin API is the whole of the
 * available surface (docs/01-DECISIONS.md §21, docs/04-SCREENS.md A8).
 *
 * Three things keep that from being a hole:
 *
 *   · The authorisation is still decided by the database. The caller's own
 *     session has to get an answer out of public.admin_list_users() — which
 *     asserts app.is_admin() itself — before this module is reached at all.
 *     A route handler check alone would not be enough (HANDOFF.md).
 *   · What the key can mint is inert. app.handle_new_user() forces the new
 *     profile to role 'rep', and a rep with no `hotel_reps` row can read
 *     nothing but their own profile row. Making that account an admin still
 *     needs public.admin_set_user_role(), which re-checks in the database and
 *     refuses to change the caller's own role (IR113).
 *   · Every account event is written to the security log with the address
 *     hashed, never in clear, and never with the password.
 */

/**
 * WHY THE CREDENTIAL IS SHOWN ON SCREEN RATHER THAN EMAILED, recorded because
 * it was a real choice with a real loser.
 *
 * Supabase offers both shapes: inviteUserByEmail() posts a magic link, or
 * createUser() mints an account whose credential the boss hands over.
 *
 * The invite link needs email delivery to work, and email delivery is client
 * item 8 — there is no domain and no SMTP account, which is exactly why
 * src/lib/email/mailer.ts has never sent anything. Supabase's built-in sender
 * exists but is rate limited to a couple of messages an hour and is documented
 * as being for testing only. An invite that does not arrive is a rep who
 * cannot sign in, at a hotel desk, during the two-week pilot that the whole
 * October date is for.
 *
 * Handing it over needs nothing. The boss has 6–10 reps and stands in front of
 * them. So: a PIN generated HERE — never chosen by the boss, never a pattern,
 * never derived from the name — shown once on screen at the moment of creation
 * and not recoverable afterwards, with a re-issue action for when it is lost.
 * `email_confirm` is set so the account is usable immediately rather than
 * waiting on a confirmation mail that cannot be sent.
 *
 * WHY A PIN AND NOT A PASSWORD (docs/01-DECISIONS.md §32). The owner decided a
 * rep should have one credential and one only, and that it should be the PIN
 * they were already going to type every morning anyway. So this mints the PIN
 * at creation time and the rep signs in with it directly; there is no password
 * for them to be given, forget, or be shown twice.
 *
 * The cost, stated plainly: the boss knows the initial PIN, and there is no
 * rep-side "change my PIN" — 0027 took that away deliberately, at his ask. That
 * is narrower than it sounds — he is the owner, he already has admin rights
 * over every row, and the audit log records the actor on every write — but it
 * is real, and the answer to a PIN that has been seen by the wrong person is
 * the same as the answer to a lost one: the boss re-issues it from the person's
 * page, which is instant and always available to him. When the domain arrives,
 * inviteUserByEmail() becomes available and this becomes a choice rather than
 * the only door.
 */

/**
 * Six digits. Short enough that the boss can read it off a screen and the rep
 * can hold it in their head, and — because a six-digit keyspace is a million
 * and nothing more — never on its own: argon2id at OWASP cost
 * (src/lib/auth/pin.ts) and the login rate limit around it are what make it a
 * credential rather than a formality. Well-formed by construction for
 * isWellFormedPin(), which accepts four to eight.
 */
const PIN_LENGTH = 6

function generatePin(): string {
  let pin = ''
  // randomInt, not Math.random: rejection-sampled from the CSPRNG, so the
  // digits are uniform and not predictable from a previously issued PIN.
  for (let i = 0; i < PIN_LENGTH; i++) pin += String(randomInt(10))
  return pin
}

/** No 0/O, no 1/l/I — a legacy of when this string was read aloud. See below. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const GROUPS = 4
const GROUP_LENGTH = 4

/**
 * The password GoTrue insists on and nobody will ever type.
 *
 * auth.admin.createUser() and updateUserById() both want *a* password; there is
 * no "passwordless account" shape in the Admin API, and leaving one unset would
 * make the account unusable through the paths we do not control. So it gets
 * ~78 bits of CSPRNG that is never returned from this module, never logged,
 * never shown, and never stored anywhere we can read it back. It exists to
 * satisfy an API signature and to be forgotten in the same expression.
 */
function generateGotruePassword(): string {
  const groups: string[] = []
  for (let g = 0; g < GROUPS; g++) {
    let group = ''
    for (let i = 0; i < GROUP_LENGTH; i++) group += ALPHABET[randomInt(ALPHABET.length)]
    groups.push(group)
  }
  return groups.join('-')
}

export type AccountFailure = 'emailInUse' | 'accountFailed'

export type CreateAccountResult =
  | { ok: true; profileId: string; pin: string }
  | { ok: false; reason: AccountFailure }

/**
 * Creates the auth account, lets app.handle_new_user() create the profile
 * behind it, and issues the PIN that account will sign in with. `full_name` and
 * `lang` travel in the user metadata because that trigger is what reads them —
 * the profile row does not exist yet to be updated, and writing it here as well
 * would be two sources for one fact.
 *
 * The PIN is set in a second step for the same reason: the profile id only
 * exists once GoTrue has answered, and public.set_pin_hash() writes to a row
 * that the trigger has to have created first.
 */
export async function createRepAccount(input: {
  email: string
  fullName: string
  lang: 'el' | 'en'
  actorId: string
}): Promise<CreateAccountResult> {
  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email: input.email,
    password: generateGotruePassword(),
    email_confirm: true,
    user_metadata: { full_name: input.fullName, lang: input.lang },
  })

  if (error || !data?.user) {
    // GoTrue reports a duplicate address as a 422 rather than a SQLSTATE, so
    // it never reaches errorKey(). Anything else is deliberately not shown to
    // the caller in the provider's own words.
    const duplicate = error?.status === 422 || /already/i.test(error?.message ?? '')
    await logSecurityEvent({
      kind: duplicate ? 'user_create_duplicate' : 'user_create_failed',
      profileId: input.actorId,
      emailHash: await sha256Hex(input.email),
    })
    return { ok: false, reason: duplicate ? 'emailInUse' : 'accountFailed' }
  }

  const pin = generatePin()
  const { error: pinError } = await supabaseAdmin().rpc('set_pin_hash', {
    p_profile_id: data.user.id,
    p_hash: await hashPin(pin),
  })

  if (pinError) {
    // The account exists but has no credential, so say so rather than showing a
    // PIN that does not open anything. It is recoverable without a support
    // call: the row is already in the staff list, and "issue a new PIN" on the
    // person's page finishes exactly this step.
    await logSecurityEvent({
      kind: 'user_pin_issue_failed',
      profileId: input.actorId,
      detail: { target_profile: data.user.id },
    })
    return { ok: false, reason: 'accountFailed' }
  }

  await logSecurityEvent({
    kind: 'user_created',
    profileId: input.actorId,
    emailHash: await sha256Hex(input.email),
    detail: { created_profile: data.user.id },
  })

  return { ok: true, profileId: data.user.id, pin }
}

/**
 * A new PIN for a rep who lost theirs — or whose PIN was overheard, which is
 * the same action here. The old one stops working the moment this returns,
 * which is the point: a PIN the boss read out in a hotel lobby a month ago
 * should not still open the app.
 *
 * Two things happen in a deliberate order.
 *
 *   1. The GoTrue password is rotated to a fresh throwaway FIRST. Reps created
 *      before §32 were handed a real password, and the login screen still
 *      accepts one so those accounts keep working — so re-issuing a credential
 *      while leaving that password alive would re-issue nothing. If this step
 *      fails, nothing has changed yet and the old PIN still works.
 *   2. Then the PIN. If THIS fails the account is momentarily credential-less,
 *      which is why it is second: it is the failure the boss can fix by pressing
 *      the same button again, and the report back says it did not work.
 *
 * The role is re-read from the database rather than trusted from the caller. A
 * PIN means nothing on the admin row — he signs in with a one-time code and has
 * no PIN by design (§21) — and rotating HIS password would take away the
 * credential he actually uses if the OTP path ever needed a fallback.
 */
export async function reissueRepPin(input: {
  profileId: string
  actorId: string
}): Promise<{ ok: true; pin: string } | { ok: false; reason: AccountFailure }> {
  const admin = supabaseAdmin()

  const { data } = await admin
    .from('profiles').select('role').eq('id', input.profileId).maybeSingle()

  if ((data as { role?: string } | null)?.role !== 'rep') {
    await logSecurityEvent({
      kind: 'user_pin_reissue_refused',
      profileId: input.actorId,
      detail: { target_profile: input.profileId },
    })
    return { ok: false, reason: 'accountFailed' }
  }

  const { error: passwordError } = await admin.auth.admin.updateUserById(
    input.profileId, { password: generateGotruePassword() })

  if (passwordError) {
    await logSecurityEvent({
      kind: 'user_pin_reissue_failed',
      profileId: input.actorId,
      detail: { target_profile: input.profileId, step: 'password' },
    })
    return { ok: false, reason: 'accountFailed' }
  }

  const pin = generatePin()
  const { error: pinError } = await admin.rpc('set_pin_hash', {
    p_profile_id: input.profileId,
    p_hash: await hashPin(pin),
  })

  if (pinError) {
    await logSecurityEvent({
      kind: 'user_pin_reissue_failed',
      profileId: input.actorId,
      detail: { target_profile: input.profileId, step: 'pin' },
    })
    return { ok: false, reason: 'accountFailed' }
  }

  await logSecurityEvent({
    kind: 'user_pin_reissued',
    profileId: input.actorId,
    detail: { target_profile: input.profileId },
  })

  return { ok: true, pin }
}
