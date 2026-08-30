'use client'

import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '../env'
import type { Database } from './database.types'

/** The browser only ever holds the anon key, and only ever sees its own rows. */
export function supabaseBrowser() {
  const { supabaseUrl, supabaseAnonKey } = publicEnv()
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}
