import { z } from 'zod'

/**
 * VAPID, and which half of it is allowed where.
 *
 * The PUBLIC key has to reach the browser — `pushManager.subscribe()` takes it
 * as the applicationServerKey — so it is a NEXT_PUBLIC_ variable by necessity
 * and is safe to publish; it is a public key. The PRIVATE key signs the
 * requests this server makes to Google's and Mozilla's push services and must
 * never appear in a NEXT_PUBLIC_ variable, in client code, or in a log line
 * (docs/03-SECURITY.md, "Secrets").
 *
 * Both are read through their own accessors rather than serverEnv(), for the
 * same reason ANTHROPIC_API_KEY is: push is a convenience on top of the app,
 * not a gate in front of it. A deployment with no VAPID keys must still run —
 * R8 then says push is unavailable, and no scheduled job fails.
 */
const publicKeySchema = z.string().trim().min(80).max(200)
const privateKeySchema = z.string().trim().min(20).max(200)
const subjectSchema = z.string().trim().regex(/^(mailto:|https:\/\/).+/)

export function vapidPublicKey(): string | null {
  // Written out in full so Next can inline it at build time.
  const parsed = publicKeySchema.safeParse(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  return parsed.success ? parsed.data : null
}

export type VapidDetails = { subject: string; publicKey: string; privateKey: string }

/** Null when push is not configured, which is a supported state, not an error. */
export function vapidDetails(): VapidDetails | null {
  const publicKey = vapidPublicKey()
  const privateKey = privateKeySchema.safeParse(process.env.VAPID_PRIVATE_KEY)
  const subject = subjectSchema.safeParse(process.env.VAPID_SUBJECT)

  if (!publicKey || !privateKey.success || !subject.success) return null

  return { subject: subject.data, publicKey, privateKey: privateKey.data }
}

/**
 * The shape a subscription arrives in from the browser. Validated server-side
 * against type, shape and length before it is stored — the endpoint is a URL
 * this server will later make requests to, so it is exactly the kind of
 * client-supplied value that must not be taken on trust.
 */
export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).startsWith('https://'),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
})

export type PushSubscriptionInput = z.infer<typeof subscriptionSchema>
