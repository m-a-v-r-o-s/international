import 'server-only'

import { z } from 'zod'

/**
 * Sending the guest their copy of the agreement (docs/01-DECISIONS.md §16,
 * "optional email delivery at the signing step").
 *
 * NOTHING IS CONFIGURED YET, AND THAT IS A HONEST STATE RATHER THAN A STUB.
 * The client has not supplied a domain (blocked item 8), so there is no
 * address to send from and no SMTP account to send through. The machinery is
 * complete and the credentials are the only missing part: set the four SMTP_*
 * variables and mail starts going out with no code change.
 *
 * Until then `send()` returns `not_configured`, the signing step records the
 * address the guest gave against the contract and says plainly that the copy
 * has not gone out — which is better than a spinner that resolves to a lie.
 */
const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().min(3),
})

export type MailResult =
  | { sent: true }
  | { sent: false; reason: 'not_configured' | 'failed' }

function smtpConfig() {
  const parsed = smtpSchema.safeParse({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ?? 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  })
  return parsed.success ? parsed.data : null
}

export function mailConfigured(): boolean {
  return smtpConfig() !== null
}

export type Attachment = { filename: string; content: Uint8Array; contentType: string }

export async function send(message: {
  to: string
  subject: string
  text: string
  attachments?: Attachment[]
}): Promise<MailResult> {
  const config = smtpConfig()
  if (!config) return { sent: false, reason: 'not_configured' }

  try {
    // Imported here rather than at module scope so a deployment with no SMTP
    // configured never loads it at all.
    const nodemailer = (await import('nodemailer')).default

    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // 465 is implicit TLS; everything else starts plaintext and upgrades.
      // `requireTLS` means a server that will not upgrade is a failure rather
      // than a silent downgrade — a signed rental agreement with two licence
      // numbers on it does not cross the internet in the clear.
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      auth: { user: config.user, pass: config.pass },
    })

    await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType,
      })),
    })

    return { sent: true }
  } catch {
    // The rep is standing at a desk. A mail server that is down is not their
    // problem and must not be the guest's either: the address is recorded and
    // the pickup carries on.
    return { sent: false, reason: 'failed' }
  }
}
