import { z } from 'zod'

/**
 * Environment is validated on first use, not at import time, so a missing
 * secret fails the request that needs it with a clear message rather than
 * failing the build with a stack trace.
 *
 * The only key that may reach the browser is the anon/publishable one. The
 * service-role key, the Anthropic key and the session secret are read through
 * `serverEnv()`, which is server-only.
 */
const publicSchema = z.object({
  supabaseUrl: z.string().url(),
  supabaseAnonKey: z.string().min(20),
})

const serverSchema = z.object({
  supabaseServiceRoleKey: z.string().min(20),
  // 32+ bytes of randomness: `openssl rand -base64 48`
  sessionSecret: z.string().min(32),
})

let publicCache: z.infer<typeof publicSchema> | null = null
let serverCache: z.infer<typeof serverSchema> | null = null

export function publicEnv() {
  if (publicCache) return publicCache
  const parsed = publicSchema.safeParse({
    // Written out in full so Next can inline them at build time.
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  if (!parsed.success) {
    throw new Error(
      `Missing or invalid public environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`)
  }
  publicCache = parsed.data
  return publicCache
}

export function serverEnv() {
  if (serverCache) return serverCache
  const parsed = serverSchema.safeParse({
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    sessionSecret: process.env.SESSION_SECRET,
  })
  if (!parsed.success) {
    throw new Error(
      `Missing or invalid server environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`)
  }
  serverCache = parsed.data
  return serverCache
}

export const isProduction = process.env.NODE_ENV === 'production'
