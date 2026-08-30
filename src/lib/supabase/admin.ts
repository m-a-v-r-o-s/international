import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { publicEnv, serverEnv } from '../env'
import type { Database } from './database.types'

/**
 * The service-role client. It bypasses RLS, so it is for things the server does
 * on its own behalf and nothing else: rate limiting, the security event log,
 * device binding, PIN storage and background jobs.
 *
 * Never use it to answer a user's query. If a screen needs data, it goes
 * through supabaseServer() and the policies.
 */
let cached: ReturnType<typeof createClient<Database>> | null = null

export function supabaseAdmin() {
  if (cached) return cached
  const { supabaseUrl } = publicEnv()
  const { supabaseServiceRoleKey } = serverEnv()

  cached = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
