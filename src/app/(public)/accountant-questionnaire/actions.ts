'use server'

import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { allow, logSecurityEvent } from '@/lib/rate-limit'
import { requestIpHash } from '@/lib/auth/signin'
import { send, type Attachment } from '@/lib/email/mailer'
import { sniffType, extensionFor, type SniffedType } from '@/lib/storage/sniff'
import { verifyStamp } from '@/lib/accountant/stamp'
import {
  ASSUMPTIONS, MAX_ANSWER_LENGTH, QUESTION_IDS, SECTIONS, pick,
} from '@/lib/accountant/questionnaire'

/**
 * The one public write endpoint this application has.
 *
 * Everything else behind /login is written by somebody the database knows. This
 * is not: anybody who has the URL can POST here, so the whole file is written
 * on that assumption. Read src/lib/accountant/stamp.ts alongside it.
 *
 * ORDER OF OPERATIONS IS THE DESIGN, and it is deliberately the cheap checks
 * first: honeypot, then stamp, then the rate limiter, then Zod, and only then
 * anything that touches storage or SMTP. A flood of scripted POSTs should cost
 * us a string comparison each, not an upload.
 *
 * THE ROW IS WRITTEN BEFORE THE MAIL IS SENT, and the mail failing does not
 * fail the submission. src/lib/email/mailer.ts is unconfigured today (no
 * domain, client item 8) and returns `not_configured` on every call, so a
 * handler that treated mail as the delivery mechanism would throw away every
 * answer the accountant typed and show them a success screen. The row is the
 * delivery; the mail is a notification about it.
 */

const REPLY_TO = process.env.ACCOUNTANT_REPLY_TO ?? 'digitalaakos@gmail.com'

/** Six is more than the checklist asks for and far below the table's cap of 12. */
const MAX_FILES = 6
/**
 * THESE TWO NUMBERS ARE SET BY next.config.ts, NOT BY THE BUCKET.
 *
 * Everywhere else in this app an upload is ONE file in one action, so
 * MAX_UPLOAD_BYTES (10 MB) sits just under `serverActions.bodySizeLimit`
 * (12 MB) and the app's own cap is what refuses an oversized photo, with a
 * message, in the rep's language. That pairing is written up in next.config.ts
 * and it assumes one file.
 *
 * This form sends up to six at once. Six times ten is sixty, so the same caps
 * here would mean Next throwing a 413 before any of this code ran: a dead page
 * for the accountant, which is the exact failure that comment was written to
 * prevent. So the budget for this action is a TOTAL, and it and the per-file
 * cap both sit under 12 MB with room left for seventeen answers of text.
 *
 * The bucket still enforces 10 MB per object independently. Raising
 * bodySizeLimit instead was the alternative and was rejected: it would loosen a
 * constant reasoned about for the pickup flow in order to serve one form.
 */
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_FILE_BYTES = 9 * 1024 * 1024
/**
 * Total bytes of `answers` once serialised. Below the table's 256 KB check so
 * that an over-long submission comes back as a sentence rather than as a
 * constraint violation. See the migration for why the two numbers differ.
 */
const MAX_ANSWERS_BYTES = 200_000
/** Mail servers reject large messages; the bucket keeps the originals anyway. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

const BUCKET = 'accountant-files'

export type ReplyState = {
  done?: boolean
  error?: 'rateLimited' | 'empty' | 'tooLong' | 'fileType' | 'fileTooLarge' | 'failed'
}

const nameSchema = z.string().trim().max(120).optional()
const emailSchema = z.string().trim().toLowerCase().max(254).email().optional().or(z.literal(''))
const noteSchema = z.string().trim().max(4000).optional()
const answerSchema = z.string().trim().max(MAX_ANSWER_LENGTH)
const localeSchema = z.enum(['el', 'en']).catch('el')

export async function submitReply(
  _prev: ReplyState, formData: FormData,
): Promise<ReplyState> {
  // ── 1. Honeypot ───────────────────────────────────────────────────────────
  // A field no sighted person sees and no keyboard reaches (aria-hidden,
  // tabIndex -1, off-screen). Anything in it came from something that filled
  // every input on the page. Answered with the ordinary failure rather than a
  // distinctive one, so a script cannot learn which field gave it away.
  if (String(formData.get('company_website') ?? '') !== '') {
    return { error: 'failed' }
  }

  // ── 2. The form has to have been served by us, and read ───────────────────
  const stamp = await verifyStamp(formData.get('stamp'))
  if (stamp !== 'ok') {
    await logSecurityEvent({ kind: 'accountant_form_rejected', detail: { reason: stamp } })
    return { error: 'failed' }
  }

  // ── 3. Rate limit ─────────────────────────────────────────────────────────
  // Two buckets for two different abuses. The per-IP one stops one connection
  // submitting repeatedly; the global one caps what a distributed script can
  // put in the table at all, because unlike a login there is no account here
  // for a per-subject bucket to key on.
  const ipHash = await requestIpHash()
  const permitted =
    (await allow(`accountant-form:${ipHash}`, 5, 3600)) &&
    (await allow('accountant-form:all', 60, 3600))

  if (!permitted) {
    await logSecurityEvent({ kind: 'accountant_form_rate_limited', ipHash })
    return { error: 'rateLimited' }
  }

  // ── 4. Validate ───────────────────────────────────────────────────────────
  const locale = localeSchema.parse(formData.get('locale'))

  // Whitelisted by id, never by iterating what arrived: the keys of this jsonb
  // are ours, and a form that posts `answers[<anything>]` must not be able to
  // choose them.
  const answers: Record<string, string> = {}
  for (const id of QUESTION_IDS) {
    const parsed = answerSchema.safeParse(formData.get(`answer:${id}`) ?? '')
    if (!parsed.success) return { error: 'tooLong' }
    if (parsed.data.length > 0) answers[id] = parsed.data
  }

  const name = nameSchema.safeParse(formData.get('name') ?? undefined)
  const email = emailSchema.safeParse(formData.get('email') ?? undefined)
  const note = noteSchema.safeParse(formData.get('note') ?? undefined)

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)

  // Nothing typed and nothing attached is a mis-tap, not a submission. Saying
  // so is better than storing an empty row and thanking them for it.
  if (Object.keys(answers).length === 0 && files.length === 0 && !note.data) {
    return { error: 'empty' }
  }

  if (new TextEncoder().encode(JSON.stringify(answers)).byteLength > MAX_ANSWERS_BYTES) {
    return { error: 'tooLong' }
  }

  if (files.length > MAX_FILES) return { error: 'fileTooLarge' }

  // ── 5. The files ──────────────────────────────────────────────────────────
  // Type decided by SNIFFING the first bytes, never by the browser's `type`
  // (src/lib/storage/sniff.ts). The bucket carries the same whitelist as a
  // second, independent layer.
  const replyId = crypto.randomUUID()
  const stored: { path: string; name: string; type: SniffedType; bytes: number }[] = []
  const attachments: Attachment[] = []
  let attachmentBytes = 0

  // Checked before a single byte is read, so an over-budget submission costs
  // nothing. The client checks the same total and says so first; this is the
  // one that actually refuses.
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_FILE_BYTES) {
    return { error: 'fileTooLarge' }
  }

  for (const [index, file] of files.entries()) {
    if (file.size > MAX_FILE_BYTES) return { error: 'fileTooLarge' }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const type = sniffType(bytes)
    if (!type) return { error: 'fileType' }

    // The path is ours entirely. Nothing the uploader chose reaches it: not the
    // filename, not the extension, not the case. The original name is kept as
    // data in the row, where it cannot be a path.
    const path = `${replyId}/${index + 1}-${crypto.randomUUID()}.${extensionFor(type)}`

    const { error } = await supabaseAdmin().storage
      .from(BUCKET).upload(path, bytes, { contentType: type, upsert: false })

    if (error) return { error: 'failed' }

    stored.push({ path, name: safeDisplayName(file.name), type, bytes: bytes.byteLength })

    if (attachmentBytes + bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
      attachments.push({
        filename: `${index + 1}.${extensionFor(type)}`, content: bytes, contentType: type,
      })
      attachmentBytes += bytes.byteLength
    }
  }

  // ── 6. Store, then notify ─────────────────────────────────────────────────
  const { error: insertError } = await supabaseAdmin().from('accountant_replies').insert({
    id: replyId,
    respondent_name: name.success ? (name.data || null) : null,
    respondent_email: email.success && email.data ? email.data : null,
    respondent_note: note.success ? (note.data || null) : null,
    answers,
    files: stored,
    locale,
    ip_hash: ipHash,
    mail_status: 'not_configured',
  })

  if (insertError) {
    await logSecurityEvent({ kind: 'accountant_form_store_failed', ipHash })
    return { error: 'failed' }
  }

  const mail = await send({
    to: REPLY_TO,
    subject: `myDATA questionnaire · ${name.success && name.data ? name.data : 'reply'} · ${new Date().toISOString().slice(0, 10)}`,
    text: transcript({
      replyId,
      name: name.success ? name.data : undefined,
      email: email.success ? email.data : undefined,
      note: note.success ? note.data : undefined,
      answers,
      files: stored,
      locale,
    }),
    attachments,
  })

  // Best effort, and never allowed to turn a stored reply into a failed one.
  await supabaseAdmin().from('accountant_replies')
    .update({ mail_status: mail.sent ? 'sent' : mail.reason })
    .eq('id', replyId)

  await logSecurityEvent({
    kind: 'accountant_form_received',
    ipHash,
    detail: { answers: Object.keys(answers).length, files: stored.length, mailed: mail.sent },
  })

  return { done: true }
}

/**
 * The original filename, kept for the office to read and stripped of anything
 * that could be mistaken for structure. It is never used to build a path.
 */
function safeDisplayName(raw: string): string {
  return raw
    // Path separators first, so a name can never read as structure anywhere
    // it is printed, then control characters, so it cannot break the mail
    // body apart. It is never used to build a path either way.
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120) || 'file'
}

/**
 * The email body: every question in document order with the answer underneath,
 * so the reply reads as a filled-in copy of what was sent rather than as a
 * list of field names. Unanswered questions are marked rather than dropped,
 * because knowing which ones the accountant skipped is half the information.
 */
function transcript(reply: {
  replyId: string
  name?: string
  email?: string
  note?: string
  answers: Record<string, string>
  files: { path: string; name: string; bytes: number }[]
  locale: string
}): string {
  const blank = reply.locale === 'en' ? '(not answered)' : '(χωρίς απάντηση)'
  const lines: string[] = []

  lines.push(`Reply ${reply.replyId}`)
  lines.push(`Received ${new Date().toISOString()}`)
  if (reply.name) lines.push(`Name: ${reply.name}`)
  if (reply.email) lines.push(`Email: ${reply.email}`)
  lines.push('')

  lines.push('=== ΠΑΡΑΔΟΧΕΣ / ASSUMPTIONS ===')
  for (const assumption of ASSUMPTIONS) {
    lines.push('')
    lines.push(pick(assumption.heading, reply.locale))
    lines.push(pick(assumption.ask, reply.locale))
    lines.push(`> ${reply.answers[assumption.id] ?? blank}`)
  }

  for (const section of SECTIONS) {
    lines.push('')
    lines.push(`=== ${section.mark} · ${pick(section.title, reply.locale)} ===`)
    for (const question of section.questions) {
      lines.push('')
      lines.push(`${question.number}. ${pick(question.text, reply.locale)}`)
      lines.push(`> ${reply.answers[question.id] ?? blank}`)
    }
  }

  if (reply.note) {
    lines.push('')
    lines.push('=== ΣΧΟΛΙΑ / NOTES ===')
    lines.push(reply.note)
  }

  lines.push('')
  lines.push('=== ΑΡΧΕΙΑ / FILES ===')
  if (reply.files.length === 0) {
    lines.push('(none)')
  } else {
    for (const file of reply.files) {
      lines.push(`${file.name} · ${Math.ceil(file.bytes / 1024)} KB · ${BUCKET}/${file.path}`)
    }
  }

  return lines.join('\n')
}
