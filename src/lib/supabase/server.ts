import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv, isProduction } from '../env'
import type { Database } from './database.types'

/**
 * The request-scoped client. It carries the signed-in user's JWT, so every
 * query it makes runs as `authenticated` and lands on the RLS policies — which
 * is the point. Nothing server-side should reach for the service role just to
 * make a query convenient.
 */
export async function supabaseServer() {
  const store = await cookies()
  const { supabaseUrl, supabaseAnonKey } = publicEnv()

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, {
              ...options,
              httpOnly: true,
              secure: isProduction,
              sameSite: 'lax',
              path: '/',
            })
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so there is nothing to recover.
        }
      },
    },
  })
}
