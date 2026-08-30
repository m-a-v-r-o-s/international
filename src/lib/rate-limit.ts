import 'server-only'

import { supabaseAdmin } from './supabase/admin'

/**
 * Rate limiting lives in Postgres rather than in memory, because Railway can
 * run more than one instance and an in-process counter would then be a
 * suggestion rather than a limit.
 *
 * Returns true when the call may proceed.
 */
export async function allow(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc('rate_limit_hit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })

  // Fail closed: if the limiter itself is unreachable, do not hand out
  // unlimited attempts at a password or an OCR budget.
  if (error) return false
  return data === true
}

export type SecurityEvent = {
  kind: string
  profileId?: string | null
  emailHash?: string | null
  ipHash?: string | null
  detail?: Record<string, string | number | boolean>
}

/** Never a token, never a licence number, never a request body. */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  await supabaseAdmin().rpc('log_security_event', {
    p_kind: event.kind,
    p_profile_id: event.profileId ?? null,
    p_email_hash: event.emailHash ?? null,
    p_ip_hash: event.ipHash ?? null,
    p_detail: event.detail ?? {},
  })
}
