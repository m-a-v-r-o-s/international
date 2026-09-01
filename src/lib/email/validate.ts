import 'server-only'

import { resolveMx } from 'node:dns/promises'
import { z } from 'zod'

/**
 * "Only finish the booking if the email checks out" — two checks, run at
 * submit time on the booking-creation actions, never on every keystroke: a DNS
 * lookup per character would be both useless (nobody finishes typing a domain
 * mid-word) and the same rate-limit hazard the phone lookup already avoids by
 * asking on blur rather than on change.
 *
 * Format first, because a malformed address has no domain worth resolving.
 * Then an MX lookup on the domain — not a mailbox probe, which needs an SMTP
 * conversation this app has no business opening — so it catches the actual
 * failure mode reps hit on a phone call: a mistyped domain like
 * "@gmial.com" that is well-formed and simply cannot receive mail. A domain
 * that answers with no MX records but does resolve as a bare A/AAAA record is
 * accepted too (RFC 5321 §5.1's fallback), which is why the check tries an MX
 * lookup and only fails on ENOTFOUND/ENODATA rather than on "no MX".
 */
const emailSchema = z.string().trim().min(1).max(254).email()

export type EmailCheck =
  | { ok: true; email: string }
  | { ok: false; reason: 'emailInvalid' | 'emailUndeliverable' }

export async function verifyEmail(raw: string): Promise<EmailCheck> {
  const parsed = emailSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'emailInvalid' }

  const email = parsed.data
  const domain = email.split('@')[1]
  if (!domain) return { ok: false, reason: 'emailInvalid' }

  try {
    await resolveMx(domain)
    return { ok: true, email }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // Anything other than "this domain does not exist / has no records" — a
    // resolver timeout, the container's own DNS being unreachable — is not
    // evidence the guest's address is wrong, so it is not treated as one.
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { ok: false, reason: 'emailUndeliverable' }
    }
    return { ok: true, email }
  }
}
