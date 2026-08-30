import 'server-only'

import { randomInt } from 'node:crypto'
import { supabaseAdmin } from '../supabase/admin'
import { logSecurityEvent } from '../rate-limit'
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
 * WHY A TEMPORARY PASSWORD RATHER THAN AN INVITE LINK, recorded because it was
 * a real choice with a real loser.
 *
 * docs/01-DECISIONS.md §21 says a rep signs in with "email + password on first
 * use, then PIN". Supabase offers both shapes: inviteUserByEmail() posts a
 * magic link, or createUser() sets a password the boss hands over.
 *
 * The invite link needs email delivery to work, and email delivery is client
 * item 8 — there is no domain and no SMTP account, which is exactly why
 * src/lib/email/mailer.ts has never sent anything. Supabase's built-in sender
 * exists but is rate limited to a couple of messages an hour and is documented
 * as being for testing only. An invite that does not arrive is a rep who
 * cannot sign in, at a hotel desk, during the two-week pilot that the whole
 * October date is for.
 *
 * The temp password needs nothing. The boss has 6–10 reps and stands in front
 * of them. So: a strong password generated HERE — never chosen by the boss,
 * never a pattern, never derived from the name — shown once on screen at the
 * moment of creation and not recoverable afterwards, with a re-issue action
 * for when it is lost. `email_confirm` is set so the account is usable
 * immediately rather than waiting on a confirmation mail that cannot be sent.
 *
 * The cost, stated plainly: the boss knows the initial password, so until the
 * rep changes it he could sign in as them. That is narrower than it sounds —
 * he is the owner, he already has admin rights over every row, and the audit
 * log records the actor on every write — but it is real, and rep-side password
 * change belongs with WebAuthn in the Phase 5 hardening list. When the domain
 * arrives, inviteUserByEmail() becomes available and this becomes a choice
 * rather than the only door.
 */

/** No 0/O, no 1/l/I: the boss reads this off a screen and a rep types it on a phone. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const GROUPS = 4
const GROUP_LENGTH = 4

/**
 * ~78 bits from crypto.randomInt's rejection sampling — not Math.random, and
 * not a shuffled word list. Hyphenated because it gets read aloud.
 */
export function generateTempPassword(): string {
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
  | { ok: true; profileId: string; password: string }
  | { ok: false; reason: AccountFailure }

/**
 * Creates the auth account and lets app.handle_new_user() create the profile
 * behind it. `full_name` and `lang` travel in the user metadata because that
 * trigger is what reads them — the profile row does not exist yet to be
 * updated, and writing it here as well would be two sources for one fact.
 */
export async function createRepAccount(input: {
  email: string
  fullName: string
  lang: 'el' | 'en'
  actorId: string
}): Promise<CreateAccountResult> {
  const password = generateTempPassword()

  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email: input.email,
    password,
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

  await logSecurityEvent({
    kind: 'user_created',
    profileId: input.actorId,
    emailHash: await sha256Hex(input.email),
    detail: { created_profile: data.user.id },
  })

  return { ok: true, profileId: data.user.id, password }
}

/**
 * A new temporary password for a rep who lost theirs. The old one stops
 * working the moment this returns, which is the point: a password the boss
 * read out in a hotel lobby a month ago should not still open the app.
 */
export async function resetRepPassword(input: {
  profileId: string
  actorId: string
}): Promise<{ ok: true; password: string } | { ok: false; reason: AccountFailure }> {
  const password = generateTempPassword()

  const { error } = await supabaseAdmin().auth.admin.updateUserById(input.profileId, { password })

  if (error) {
    await logSecurityEvent({
      kind: 'user_password_reset_failed',
      profileId: input.actorId,
      detail: { target_profile: input.profileId },
    })
    return { ok: false, reason: 'accountFailed' }
  }

  await logSecurityEvent({
    kind: 'user_password_reset',
    profileId: input.actorId,
    detail: { target_profile: input.profileId },
  })

  return { ok: true, password }
}
